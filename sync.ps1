Write-Host "[1/3] Проверка обновлений в репозитории..." -ForegroundColor Cyan
git fetch origin
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ОШИБКА] Не удалось связаться с GitHub. Проверьте соединение или права доступа." -ForegroundColor Red
    exit 1
}

Write-Host "[2/3] Получение изменений (rebase + autostash)..." -ForegroundColor Cyan
git pull --rebase --autostash origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ВНИМАНИЕ] Возникли конфликты. Разрешите их или попросите ИИ помочь." -ForegroundColor Yellow
    exit 1
}

Write-Host "[3/3] Синхронизация завершена успешно!" -ForegroundColor Green
git status -sb
