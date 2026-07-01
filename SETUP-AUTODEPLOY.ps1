# === PMS auto-deploy setup ===
# Turns C:\Users\sukju\OneDrive\Desktop\PMS\app into a git repo that pushes to GitHub,
# so future deploys = just `git push`. Run from anywhere.
$ErrorActionPreference='Stop'

$app = "C:\Users\sukju\OneDrive\Desktop\PMS\app"
if (-not (Test-Path (Join-Path $app 'src\lib\crud.ts'))) {
  Write-Host "Project not found at $app - edit the path in this script." -ForegroundColor Red; exit 1
}
Set-Location $app
Write-Host "Project: $app" -ForegroundColor Green

# 1) .gitignore (keep repo clean)
$gi = @(
  'node_modules/', '.next/', '.vercel/', '.env', '.env*.local',
  'npm-debug.log*', '*.tsbuildinfo'
) -join "`n"
[IO.File]::WriteAllText((Join-Path $app '.gitignore'), $gi, [Text.UTF8Encoding]::new($false))
Write-Host "wrote .gitignore" -ForegroundColor Green

# 2) git init if needed
if (-not (Test-Path (Join-Path $app '.git'))) {
  git init | Out-Null
  git branch -M main
  Write-Host "git initialized (branch main)" -ForegroundColor Green
} else {
  Write-Host ".git already exists" -ForegroundColor Yellow
}

# 3) remote
$remote = git remote get-url origin 2>$null
if (-not $remote) {
  Write-Host ""
  $url = Read-Host "Enter your GitHub repo URL (e.g. https://github.com/AI-JUNE/pms-saas.git)"
  git remote add origin $url
  Write-Host "remote 'origin' set to $url" -ForegroundColor Green
} else {
  Write-Host "remote already set: $remote" -ForegroundColor Yellow
}

# 4) commit + push
git add -A
git commit -m "chore: connect PMS\app for Vercel auto-deploy (v15)" 2>$null
Write-Host "Pushing to GitHub..." -ForegroundColor Cyan
git push -u origin main
if ($LASTEXITCODE -eq 0) {
  Write-Host ""
  Write-Host "PUSHED. Now finish in the Vercel dashboard:" -ForegroundColor Green
  Write-Host "  Vercel > pms-saas > Settings > Git > Connect Git Repository > pick this repo." -ForegroundColor Green
  Write-Host "After that, every 'git push' auto-deploys." -ForegroundColor Green
} else {
  Write-Host "git push failed - copy the error above and send it." -ForegroundColor Red
}
