# Mi red — instalación y despliegue

## Qué contiene
- `public/app.html`: interfaz responsive en español, Firebase Authentication, formularios, búsqueda, publicaciones y carga a Cloudinary.
- `server.js`: API Express con verificación de Firebase ID tokens, control de propietario, endpoint de firma Cloudinary y endpoints PayPal.
- `firestore.rules`: bloquea el acceso directo a colecciones desde clientes; el backend usa Firebase Admin.
- `.env.example`: lista de variables de entorno. No contiene secretos reales.

## Antes de desplegar
La configuración de Firebase del HTML contiene la configuración pública del proyecto `mi-red-a687d`. Las claves `apiKey` de Firebase para aplicaciones web no sustituyen reglas de seguridad. Debes configurar el backend con una cuenta de servicio privada de Firebase Admin.

### 1. Firebase
1. En Firebase Console, abre el proyecto `mi-red-a687d`.
2. Authentication → Sign-in method → habilita **Correo electrónico/contraseña**.
3. Authentication → Settings → Authorized domains: agrega el dominio de Render cuando lo tengas.
4. Firestore Database → crea la base de datos.
5. Firestore → Rules: publica el contenido de `firestore.rules`.
6. Project settings → Service accounts → Generate new private key. Guarda el JSON en un lugar seguro. En Render crea `FIREBASE_SERVICE_ACCOUNT_JSON` y pega el JSON completo como valor. No lo subas a GitHub.

### 2. Cloudinary
1. En Cloudinary Console, abre API Keys y copia API Key y API Secret.
2. En Render configura `CLOUDINARY_CLOUD_NAME=olte8v49`, `CLOUDINARY_API_KEY` y `CLOUDINARY_API_SECRET`.
3. El backend firma cada carga y la carpeta se limita por UID. No pongas el API Secret en el HTML.
4. El formulario admite hasta 5 archivos de 10 MB cada uno. Ajusta los límites según tu plan y políticas de Cloudinary.

### 3. PayPal
1. En developer.paypal.com crea una app REST para Sandbox y copia Client ID y Secret a Render.
2. En PayPal crea un producto y un plan de suscripción mensual de **USD 5.00**. Configura `PAYPAL_PLAN_ID` con el ID real del plan.
3. Configura `PAYPAL_MODE=sandbox` durante las pruebas.
4. Crea un webhook que apunte a `https://TU-SERVICIO.onrender.com/api/paypal/webhook`, copia el ID a `PAYPAL_WEBHOOK_ID` y selecciona eventos de suscripción (activación, cancelación, suspensión y expiración).
5. Prueba con cuentas Sandbox antes de pasar a `PAYPAL_MODE=live`. No uses credenciales de producción en pruebas.
6. La interfaz no declara Premium activo por una respuesta del navegador; el backend consulta la suscripción y verifica firma del webhook. Comprueba en Sandbox todos los estados y eventos antes de vender el plan.

## Despliegue en GitHub y Render
1. Crea un repositorio de GitHub y sube `server.js`, `package.json`, `firestore.rules`, `.env.example` y la carpeta `public` con `app.html`.
2. Render → New → **Web Service** → conecta el repositorio.
3. Runtime: Node. Build command: `npm install`. Start command: `npm start`.
4. Agrega todas las variables del apartado `.env.example` en Render → Environment. No agregues las credenciales reales a GitHub.
5. Despliega. Abre `https://TU-SERVICIO.onrender.com/api/health`. `firebaseAdmin` y `cloudinary` deben mostrar `true` cuando estén configurados.
6. En Firebase Authentication, agrega el dominio real de Render a Authorized domains.
7. En `ALLOWED_ORIGIN` usa el dominio exacto de tu app. Si cambias el dominio, actualiza esa variable y `PUBLIC_APP_URL`.
8. Comprueba registro, inicio de sesión, publicación, carga de imágenes, edición/eliminación con dos usuarios distintos y suscripción PayPal Sandbox.

## Datos que aún necesitas configurar
- Firebase Admin service account JSON (secreto del servidor).
- Cloudinary API Secret (no está en las capturas); API Key también debe configurarse como variable.
- PayPal Client ID, Client Secret, Plan ID de USD 5/mes y Webhook ID. El texto compartido en el chat no permite identificar de forma segura todos esos valores.

## Limitaciones importantes de esta versión
- La aplicación real guarda y consulta publicaciones por medio de Firestore a través del backend.
- La búsqueda por texto/ciudad filtra el conjunto limitado de publicaciones cargadas; para catálogos grandes debe añadirse paginación con cursores e índices.
- El botón “Cerca de ti” solicita permiso real de geolocalización, pero todavía no calcula y ordena distancias ni muestra un mapa interactivo.
- No se implementa procesamiento de transacciones para comprar productos, reservas confirmadas, reseñas ni cobro de campañas publicitarias.
- El panel de usuario lista y elimina publicaciones y permite abrir el formulario de edición. Los archivos nuevos se suben a Cloudinary; la eliminación de assets antiguos requiere implementar borrado firmado y política de retención.
- Para producción comercial, agrega CAPTCHA/anti-spam, pruebas automatizadas, auditoría de permisos, política de privacidad, términos y supervisión de costos.
- No se han ejecutado pruebas de extremo a extremo contra tus cuentas reales; debes seguir la lista de comprobación.

## Lista de comprobación
- [ ] Authentication: registrar una cuenta de prueba.
- [ ] Iniciar y cerrar sesión.
- [ ] Recuperar contraseña.
- [ ] Publicar un negocio y verlo en la página pública.
- [ ] Publicar producto, servicio, evento, lugar y promoción.
- [ ] Subir imagen y comprobar su URL segura de Cloudinary.
- [ ] Editar publicación propia.
- [ ] Confirmar que un segundo usuario no puede editar/eliminar la publicación ajena.
- [ ] Rechazar permiso de ubicación y comprobar que la búsqueda por ciudad sigue disponible.
- [ ] Configurar PayPal Sandbox y probar aprobación, pendiente, cancelación y expiración.
- [ ] Confirmar que no se activa Premium con credenciales incompletas o estado no activo.
- [ ] Probar el diseño en móvil y escritorio.
