@echo off
REM Doble clic para arrancar VoxForge (backend + frontend).
REM Invoca el script de PowerShell saltando la politica de ejecucion.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0levantar-app.ps1"
echo.
echo (Esta ventana ya no hace falta; puedes cerrarla. Los servicios corren en sus propias ventanas.)
pause
