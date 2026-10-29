@echo off
REM Publica todo: base de datos, funcion de invitaciones, configuracion de Auth, codigo y web.
call npx.cmd supabase db push --linked --yes
call npx.cmd supabase functions deploy invitar-usuario --use-api
call npx.cmd supabase secrets set APP_URL=https://gestoria-paris.gestoria-grupoparis.workers.dev
call npx.cmd supabase config push --yes
git push origin feat/etapa1-nucleo
git push origin feat/etapa1-nucleo:main
echo.
echo Listo. La web se actualiza en 1-2 minutos.
pause
