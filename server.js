const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const admin = require("firebase-admin");
const cloudinary = require("cloudinary").v2;
const crypto = require("crypto");

const app = express();
app.set("trust proxy", 1);
app.use(helmet({ crossOriginEmbedderPolicy: false, contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN ? process.env.ALLOWED_ORIGIN.split(",").map(x => x.trim()) : true }));
app.use(express.json({ limit: "200kb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS && !admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
}
const db = admin.apps.length ? admin.firestore() : null;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || "olte8v49",
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

const publicCollections = new Set(["businesses","products","services","events","venues","advertisements"]);
const safeText = (v, max=3000) => typeof v === "string" ? v.trim().slice(0,max) : "";
const fail = (res, code, message) => res.status(code).json({ error: message });
function requireDb(req,res,next) {
  if (!db) return fail(res,503,"Firebase Admin no está configurado en el servidor. Revisa FIREBASE_SERVICE_ACCOUNT_JSON.");
  next();
}
async function auth(req,res,next) {
  try {
    if (!admin.apps.length) return fail(res,503,"Firebase Admin no está configurado.");
    const h = req.headers.authorization || "";
    if (!h.startsWith("Bearer ")) return fail(res,401,"Inicia sesión para continuar.");
    req.user = await admin.auth().verifyIdToken(h.slice(7));
    next();
  } catch { return fail(res,401,"Sesión no válida o vencida."); }
}
function cleanDoc(body, uid, collection) {
  const allowed = ["name","title","description","category","address","city","phone","email","website","images","videoUrl","price","currency","stock","delivery","deliveryZones","hours","latitude","longitude","startAt","endAt","freeEntry","ticketUrl","capacity","servicesIncluded","conditions","availability","status","businessId","organizer","contact","budget","startDate","endDate","targetArea","adType","createdAt"];
  const out = {};
  for (const k of allowed) if (body[k] !== undefined) out[k] = body[k];
  out.ownerId = uid;
  out.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  if (!body.createdAt) out.createdAt = admin.firestore.FieldValue.serverTimestamp();
  out.type = collection;
  return out;
}
app.get("/api/health", (req,res) => res.json({ ok:true, service:"mi-red", firebaseAdmin:!!db, cloudinary:!!(process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET), paypalConfigured:!!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) }));

app.get("/api/public/:collection", requireDb, async (req,res) => {
  const c = req.params.collection;
  if (!publicCollections.has(c)) return fail(res,400,"Categoría no válida.");
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || "40",10) || 40,1),100);
    let q = db.collection(c).where("status","!=", "deleted").limit(limit);
    const snap = await q.get();
    const docs = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    const term = safeText(req.query.q,100).toLocaleLowerCase();
    const city = safeText(req.query.city,100).toLocaleLowerCase();
    const filtered = docs.filter(d => {
      const hay = [d.name,d.title,d.description,d.category,d.address,d.city].filter(Boolean).join(" ").toLocaleLowerCase();
      return (!term || hay.includes(term)) && (!city || String(d.city||d.address||"").toLocaleLowerCase().includes(city));
    });
    res.json({ items: filtered });
  } catch(e) { console.error(e); fail(res,500,"No se pudieron cargar las publicaciones."); }
});

app.get("/api/mine", auth, requireDb, async (req,res) => {
  try {
    const names = [...publicCollections];
    const result = {};
    for (const c of names) {
      const snap = await db.collection(c).where("ownerId","==",req.user.uid).limit(100).get();
      result[c] = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    }
    res.json(result);
  } catch(e) { console.error(e); fail(res,500,"No se pudieron cargar tus publicaciones."); }
});

app.post("/api/:collection", auth, requireDb, async (req,res) => {
  const c = req.params.collection;
  if (!publicCollections.has(c)) return fail(res,400,"Categoría no válida.");
  const name = safeText(req.body.name || req.body.title,160);
  if (!name) return fail(res,400,"El nombre o título es obligatorio.");
  try {
    const doc = cleanDoc(req.body,req.user.uid,c);
    doc.name = name;
    doc.status = ["draft","hidden","cancelled"].includes(req.body.status) ? req.body.status : "published";
    const ref = await db.collection(c).add(doc);
    res.status(201).json({ id:ref.id, ...doc, createdAt:null, updatedAt:null });
  } catch(e) { console.error(e); fail(res,500,"No se pudo guardar la publicación."); }
});

app.put("/:collection/:id", auth, requireDb, async (req,res) => {
  const c = req.params.collection;
  if (!publicCollections.has(c)) return fail(res,400,"Categoría no válida.");
  try {
    const ref = db.collection(c).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return fail(res,404,"Publicación no encontrada.");
    if (snap.data().ownerId !== req.user.uid) return fail(res,403,"Solo el propietario puede editar esta publicación.");
    const doc = cleanDoc(req.body,req.user.uid,c);
    if (req.body.name || req.body.title) doc.name = safeText(req.body.name || req.body.title,160);
    await ref.set(doc,{merge:true});
    res.json({ ok:true });
  } catch(e) { console.error(e); fail(res,500,"No se pudo actualizar."); }
});
app.delete("/:collection/:id", auth, requireDb, async (req,res) => {
  const c = req.params.collection;
  if (!publicCollections.has(c)) return fail(res,400,"Categoría no válida.");
  try {
    const ref = db.collection(c).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return fail(res,404,"Publicación no encontrada.");
    if (snap.data().ownerId !== req.user.uid) return fail(res,403,"Solo el propietario puede eliminar esta publicación.");
    await ref.update({ status:"deleted", updatedAt:admin.firestore.FieldValue.serverTimestamp() });
    res.json({ ok:true });
  } catch(e) { console.error(e); fail(res,500,"No se pudo eliminar."); }
});

app.post("/api/cloudinary/signature", auth, (req,res) => {
  if (!process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) return fail(res,503,"Configura CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET en Render.");
  const timestamp = Math.floor(Date.now()/1000);
  const folder = `mi-red/${req.user.uid}`;
  const params = { timestamp, folder };
  const signature = cloudinary.utils.api_sign_request(params, process.env.CLOUDINARY_API_SECRET);
  res.json({ timestamp, folder, signature, apiKey:process.env.CLOUDINARY_API_KEY, cloudName:process.env.CLOUDINARY_CLOUD_NAME || "olte8v49" });
});

// PayPal: el backend crea y consulta la suscripción. Nunca se acepta Premium desde el navegador.
async function paypalToken() {
  const id=process.env.PAYPAL_CLIENT_ID, secret=process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Configura PAYPAL_CLIENT_ID y PAYPAL_CLIENT_SECRET.");
  const base = process.env.PAYPAL_MODE === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const r=await fetch(`${base}/v1/oauth2/token`,{method:"POST",headers:{Authorization:`Basic ${basic}`,"Content-Type":"application/x-www-form-urlencoded"},body:"grant_type=client_credentials"});
  const d=await r.json(); if(!r.ok) throw new Error("PayPal no pudo autorizar la solicitud.");
  return {token:d.access_token,base};
}
app.post("/api/paypal/create-subscription", auth, async (req,res) => {
  try {
    if (!process.env.PAYPAL_PLAN_ID) return fail(res,503,"Falta PAYPAL_PLAN_ID. Crea un plan de suscripción de USD 5/mes en PayPal.");
    const {token,base}=await paypalToken();
    const r=await fetch(`${base}/v1/billing/subscriptions`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json","PayPal-Request-Id":crypto.randomUUID()},body:JSON.stringify({plan_id:process.env.PAYPAL_PLAN_ID,custom_id:req.user.uid,application_context:{brand_name:"Mi red",user_action:"SUBSCRIBE_NOW",return_url:`${process.env.PUBLIC_APP_URL || ""}/?premium=return`,cancel_url:`${process.env.PUBLIC_APP_URL || ""}/?premium=cancel`}})});
    const d=await r.json(); if(!r.ok) return fail(res,502,"PayPal no pudo crear la suscripción.");
    res.json({id:d.id,approvalUrl:(d.links||[]).find(x=>x.rel==="approve")?.href});
  } catch(e) { console.error(e.message); fail(res,503,e.message.includes("Configura")?e.message:"No se pudo iniciar PayPal."); }
});
app.get("/api/paypal/subscription/:id", auth, async (req,res) => {
  try {
    const {token,base}=await paypalToken();
    const r=await fetch(`${base}/v1/billing/subscriptions/${encodeURIComponent(req.params.id)}`,{headers:{Authorization:`Bearer ${token}`}});
    const d=await r.json(); if(!r.ok) return fail(res,502,"No se pudo verificar la suscripción.");
    if (d.custom_id !== req.user.uid) return fail(res,403,"La suscripción no pertenece a esta cuenta.");
    const active = d.status === "ACTIVE";
    if (db) await db.collection("subscriptions").doc(req.user.uid).set({paypalSubscriptionId:d.id,status:d.status,premium:active,updatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
    res.json({status:d.status,premium:active,nextBillingTime:d.billing_info?.next_billing_time || null});
  } catch(e) { console.error(e.message); fail(res,503,"PayPal no está configurado correctamente."); }
});

app.post("/api/paypal/webhook", async (req,res) => {
  // For production, configure a webhook ID and verify signature using PayPal's verify-webhook-signature endpoint.
  // No Premium entitlement is granted here until that verification is implemented/configured.
  if (!process.env.PAYPAL_WEBHOOK_ID) return fail(res,503,"Falta PAYPAL_WEBHOOK_ID; el webhook no está activado.");
  try {
    const {token,base}=await paypalToken();
    const headers = req.headers;
    const payload={auth_algo:headers["paypal-auth-algo"],cert_url:headers["paypal-cert-url"],transmission_id:headers["paypal-transmission-id"],transmission_sig:headers["paypal-transmission-sig"],transmission_time:headers["paypal-transmission-time"],webhook_id:process.env.PAYPAL_WEBHOOK_ID,webhook_event:req.body};
    const vr=await fetch(`${base}/v1/notifications/verify-webhook-signature`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const vd=await vr.json();
    if (!vr.ok || vd.verification_status!=="SUCCESS") return fail(res,400,"Firma del webhook de PayPal no válida.");
    const event=req.body;
    const subId=event.resource?.id;
    const uid=event.resource?.custom_id;
    if (db && uid && subId) {
      const status = event.event_type?.includes("ACTIVATED") ? "ACTIVE" :
        event.event_type?.includes("CANCELLED") ? "CANCELLED" :
        event.event_type?.includes("SUSPENDED") ? "SUSPENDED" :
        event.event_type?.includes("EXPIRED") ? "EXPIRED" : null;
      if(status) await db.collection("subscriptions").doc(uid).set({paypalSubscriptionId:subId,status,premium:status==="ACTIVE",updatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
    }
    res.json({received:true});
  } catch(e) { console.error(e.message); fail(res,500,"No se pudo procesar el webhook."); }
});

app.use(express.static("public"));
app.get("*",(req,res)=>res.sendFile(require("path").join(process.cwd(),"public","app.html")));
const port=process.env.PORT || 3000;
app.listen(port,"0.0.0.0",()=>console.log(`Mi red escuchando en puerto ${port}`));
