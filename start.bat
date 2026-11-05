@echo off
title LushCake
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
echo Dang khoi dong LushCake...
call npx electron .
