@echo off
chcp 65001 >nul
echo [1/3] Проверка обновлений в репозитории...
git fetch origin

if errorlevel 1 (
    echo [ОШИБКА] Не удалось связаться с GitHub. Проверьте сеть или доступ.
    pause
    exit /b 1
)

echo [2/3] Получение изменений с авто-сохранением локальной работы (autostash + rebase)...
git pull --rebase --autostash origin main

if errorlevel 1 (
    echo [ВНИМАНИЕ] Возник конфликт слияния. Пожалуйста, разрешите конфликты или попросите агента помочь.
    pause
    exit /b 1
)

echo [3/3] Синхронизация завершена успешно!
git status -sb
pause
