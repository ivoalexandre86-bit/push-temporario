@echo off
title Sistema de Gestao de Projetos
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo [ERRO] O Node.js nao foi encontrado neste computador.
    echo Instale o Node.js versao 20 ou superior em https://nodejs.org e clique de novo neste atalho.
    pause
    exit /b 1
)

node scripts\iniciar.js
pause
