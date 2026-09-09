/* ============================================================
   Общий модуль: Firebase + авторизация + доступ к поездкам.
   Используется trips/index.html и страницами поездок.

   Модель доступа:
   - вход по email+паролю через Firebase Authentication
   - профиль лежит в users/{uid}, флаг isAdmin решает, можно ли
     видеть детали и править данные
   - настоящая защита — в правилах Firestore (firestore.rules),
     этот файл только рисует UI; обойти его через консоль браузера
     бесполезно, записи отклонит сервер
   ============================================================ */

const V = 'https://www.gstatic.com/firebasejs/10.12.2/';

let _app = null, _auth = null, _db = null, _mods = null;

export function isConfigured(){
  const c = window.TRIPS_FIREBASE;
  return !!(c && c.apiKey && c.projectId);
}

/* Ленивая инициализация SDK — один раз на страницу. */
export async function initFirebase(){
  if(_mods) return _mods;
  if(!isConfigured()) throw new Error('Firebase не настроен (trips/firebase_config.js)');

  const [appMod, authMod, fsMod] = await Promise.all([
    import(V+'firebase-app.js'),
    import(V+'firebase-auth.js'),
    import(V+'firebase-firestore.js')
  ]);

  _app  = appMod.initializeApp(window.TRIPS_FIREBASE);
  _auth = authMod.getAuth(_app);
  _db   = fsMod.getFirestore(_app);
  // сессия переживает перезагрузку и закрытие вкладки
  await authMod.setPersistence(_auth, authMod.browserLocalPersistence).catch(()=>{});

  _mods = { app:_app, auth:_auth, db:_db, authMod, fsMod };
  return _mods;
}

/* ---------- логины ----------
   Пользователи входят коротким именем, а Firebase Auth требует email.
   Поэтому имя разворачивается в служебный адрес. */
const EMAIL_DOMAIN = 'dentep.local';

export function nameToEmail(name){
  const n = String(name||'').trim().toLowerCase();
  if(!n) return '';
  return n.includes('@') ? n : n+'@'+EMAIL_DOMAIN;
}
export function emailToName(email){
  return String(email||'').split('@')[0];
}

export async function signIn(name, password){
  const { auth, authMod } = await initFirebase();
  const email = nameToEmail(name);
  const cred = await authMod.signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function signOut(){
  const { auth, authMod } = await initFirebase();
  await authMod.signOut(auth);
}

/* Читаемые сообщения вместо кодов Firebase. */
export function authErrorText(e){
  const c = (e && e.code) || '';
  if(/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c))
    return 'Неверный логин или пароль.';
  if(/weak-password/.test(c))
    return 'Firebase требует пароль минимум из 6 символов.';
  if(/too-many-requests/.test(c))
    return 'Слишком много попыток. Подожди немного и попробуй снова.';
  if(/network-request-failed/.test(c))
    return 'Нет связи с сервером. Проверь интернет.';
  if(/operation-not-allowed/.test(c))
    return 'Вход по паролю не включён в Firebase (Authentication → Sign-in method).';
  return (e && e.message) ? e.message : 'Не удалось войти.';
}

/* ---------- профиль и права ----------
   Профиль читается из users/{uid}. Нет документа — прав нет. */
export async function loadProfile(user){
  if(!user) return null;
  const { db, fsMod } = await initFirebase();
  const base = { uid:user.uid, email:user.email||'', name:emailToName(user.email), isAdmin:false };
  try{
    const snap = await fsMod.getDoc(fsMod.doc(db, 'users', user.uid));
    if(!snap.exists()){
      // аккаунт есть, а профиля нет — прав не будет, пока не создан users/{uid}
      return Object.assign(base, { noProfile:true });
    }
    const data = snap.data();
    return {
      uid: user.uid,
      email: user.email || '',
      name: data.name || emailToName(user.email),
      isAdmin: data.isAdmin === true
    };
  }catch(e){
    console.warn('profile read failed', e);
    return Object.assign(base, { readFailed:true });
  }
}

/* Подписка на состояние входа: колбэк получает профиль или null. */
export async function onUser(cb){
  const { auth, authMod } = await initFirebase();
  return authMod.onAuthStateChanged(auth, async (user)=>{
    cb(user ? await loadProfile(user) : null);
  });
}

/* Ждёт первое разрешение состояния — для страниц, которым нужен гейт. */
export function waitForUser(){
  return new Promise(async (resolve)=>{
    const { auth, authMod } = await initFirebase();
    const off = authMod.onAuthStateChanged(auth, async (user)=>{
      off();
      resolve(user ? await loadProfile(user) : null);
    });
  });
}

/* ---------- данные поездок ----------
   Каждая поездка — документ trips/{id}: {title, emoji, dates, rows, candidates, files}. */
export async function listTrips(){
  const { db, fsMod } = await initFirebase();
  const snap = await fsMod.getDocs(fsMod.collection(db, 'trips'));
  const out = [];
  snap.forEach(d => out.push(Object.assign({ id:d.id }, d.data())));
  return out;
}

export async function getTrip(id){
  const { db, fsMod } = await initFirebase();
  const snap = await fsMod.getDoc(fsMod.doc(db, 'trips', id));
  return snap.exists() ? Object.assign({ id:snap.id }, snap.data()) : null;
}

export async function saveTrip(id, data){
  const { db, fsMod } = await initFirebase();
  await fsMod.setDoc(fsMod.doc(db, 'trips', id), data);
}

export function tripRef(){ return { db:_db, fsMod:_mods && _mods.fsMod }; }
