# Tower Decision React

App React + Leaflet para colocar 5 torres con radio fijo de 2 km en tres fases de información.

## Ejecutar en Windows PowerShell

```powershell
cd tower_decision_react
npm config set registry https://registry.npmjs.org/
npm install
npm run dev
```

Después abre la URL que muestra Vite. Para usarla desde el móvil, móvil y ordenador deben estar en la misma WiFi. Normalmente será algo como:

```text
http://192.168.x.x:5173/
```

## Si npm install falla

1. Cierra VS Code y cualquier terminal que esté usando la carpeta.
2. Borra `node_modules` y `package-lock.json`.
3. Ejecuta:

```powershell
npm cache clean --force
npm config set registry https://registry.npmjs.org/
npm install --registry=https://registry.npmjs.org/
```

Si estás trabajando dentro de OneDrive y aparece `EPERM`, mueve la carpeta a una ruta local tipo `C:\dev\tower_decision_react`.

## Build

```powershell
npm run build
```
