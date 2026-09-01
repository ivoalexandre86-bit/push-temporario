@echo off
title Sistema de Gestao de Projetos
setlocal enabledelayedexpansion

set "APP_VERSION=5"
set "SRC_DIR=%~dp0"
set "APP_DIR=%LOCALAPPDATA%\SistemaGestaoProjetos"

echo ============================================
echo   Sistema de Gestao de Projetos e Acoes
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERRO] O Node.js nao foi encontrado neste computador.
    echo.
    echo Instale o Node.js ^(versao 18 ou superior^) em: https://nodejs.org
    echo Depois de instalar, feche esta janela e clique novamente no atalho.
    echo.
    pause
    exit /b 1
)

echo [1/6] Sincronizando arquivos do sistema...
robocopy "%SRC_DIR%backend" "%APP_DIR%\backend" /E /XD node_modules >nul
if errorlevel 8 (
    echo [ERRO] Falha ao copiar os arquivos do backend.
    pause
    exit /b 1
)
robocopy "%SRC_DIR%frontend" "%APP_DIR%\frontend" /E /XD node_modules dist >nul
if errorlevel 8 (
    echo [ERRO] Falha ao copiar os arquivos da interface.
    pause
    exit /b 1
)

cd /d "%APP_DIR%\backend"

if not exist ".env" (
    copy /y ".env.example" ".env" >nul
    echo.
    echo ============================================================
    echo   PRIMEIRA CONFIGURACAO NECESSARIA
    echo ============================================================
    echo Este sistema agora usa um banco de dados PostgreSQL
    echo compartilhado com o site publicado na internet.
    echo.
    echo Abra o arquivo abaixo em um editor de texto e cole a URL de
    echo conexao do banco Postgres do Render no lugar de DATABASE_URL:
    echo.
    echo   %APP_DIR%\backend\.env
    echo.
    echo Depois de salvar o arquivo, feche esta janela e clique de novo
    echo no atalho "Iniciar Sistema".
    echo ============================================================
    echo.
    pause
    exit /b 1
)

findstr /B /C:"DATABASE_URL=" ".env" >nul
if errorlevel 1 (
    echo [ERRO] O arquivo .env nao tem a variavel DATABASE_URL configurada.
    echo Edite "%APP_DIR%\backend\.env" e adicione a URL do banco Postgres do Render.
    pause
    exit /b 1
)
findstr /C:"host.render.com" ".env" >nul
if not errorlevel 1 (
    echo [ERRO] DATABASE_URL ainda esta com o valor de exemplo.
    echo Edite "%APP_DIR%\backend\.env" e cole a URL real do banco Postgres do Render
    echo ^(Dashboard do Render ^> seu banco Postgres ^> Connect ^> External Database URL^).
    pause
    exit /b 1
)

set "NEED_BACKEND_INSTALL=0"
if not exist "node_modules\pg" set "NEED_BACKEND_INSTALL=1"
if not exist "node_modules\.install-version" set "NEED_BACKEND_INSTALL=1"
if exist "node_modules\.install-version" (
    set /p INSTALLED_BE=<"node_modules\.install-version"
    if not "!INSTALLED_BE!"=="%APP_VERSION%" set "NEED_BACKEND_INSTALL=1"
)

if "!NEED_BACKEND_INSTALL!"=="1" (
    echo [2/6] Instalando dependencias do servidor - isso pode levar 1-2 minutos na primeira vez...
    call npm install --ignore-scripts
    if errorlevel 1 (
        echo.
        echo [ERRO] Falha ao instalar as dependencias do servidor.
        pause
        exit /b 1
    )
    > "node_modules\.install-version" echo %APP_VERSION%
) else (
    echo [2/6] Dependencias do servidor ja instaladas.
)

echo [3/6] Verificando estrutura do banco de dados compartilhado...
call npm run migrate
if errorlevel 1 (
    echo.
    echo [ERRO] Falha ao conectar/atualizar o banco de dados Postgres.
    echo Verifique se a DATABASE_URL em "%APP_DIR%\backend\.env" esta correta
    echo e se este computador tem acesso a internet.
    pause
    exit /b 1
)

cd /d "%APP_DIR%\frontend"

set "NEED_FRONTEND_INSTALL=0"
if not exist "node_modules\vite" set "NEED_FRONTEND_INSTALL=1"
if not exist "node_modules\.install-version" set "NEED_FRONTEND_INSTALL=1"
if exist "node_modules\.install-version" (
    set /p INSTALLED_FE=<"node_modules\.install-version"
    if not "!INSTALLED_FE!"=="%APP_VERSION%" set "NEED_FRONTEND_INSTALL=1"
)

if "!NEED_FRONTEND_INSTALL!"=="1" (
    echo [4/6] Instalando dependencias da interface - isso pode levar alguns minutos na primeira vez...
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERRO] Falha ao instalar as dependencias da interface.
        pause
        exit /b 1
    )
    > "node_modules\.install-version" echo %APP_VERSION%
)

set "REBUILD_DIST=0"
if "!NEED_FRONTEND_INSTALL!"=="1" set "REBUILD_DIST=1"
if not exist "dist" set "REBUILD_DIST=1"

if "!REBUILD_DIST!"=="1" (
    echo [5/6] Compilando a interface...
    call npm run build
    if errorlevel 1 (
        echo.
        echo [ERRO] Falha ao compilar a interface.
        pause
        exit /b 1
    )
) else (
    echo [5/6] Interface ja compilada.
)

cd /d "%APP_DIR%\backend"

echo [6/6] Tudo pronto.
echo.
echo Iniciando o servidor... o navegador abrira automaticamente em alguns segundos.
echo Este notebook e o site na internet compartilham o mesmo banco de dados,
echo entao qualquer alteracao feita aqui aparece no site e vice-versa.
echo Para ENCERRAR o sistema, feche esta janela.
echo.

start "" cmd /c "timeout /t 3 >nul && start http://localhost:4000"

call npm start

pause
