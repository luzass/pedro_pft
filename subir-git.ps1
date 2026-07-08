$ErrorActionPreference = "Stop"

$repoUrl = "https://github.com/luzass/pedro_pft.git"
$commitMessage = "Initial app setup"

Set-Location -LiteralPath $PSScriptRoot

if (Test-Path -LiteralPath ".git") {
  $hasHead = Test-Path -LiteralPath ".git\HEAD"
  $hasConfig = Test-Path -LiteralPath ".git\config"

  if (-not $hasHead -or -not $hasConfig) {
    Write-Host "Removendo .git invalido..."
    Remove-Item -LiteralPath ".git" -Recurse -Force
  }
}

if (-not (Test-Path -LiteralPath ".git")) {
  git init
}

git branch -M main

$hasOrigin = (git remote) -contains "origin"

if ($hasOrigin) {
  git remote set-url origin $repoUrl
} else {
  git remote add origin $repoUrl
}

git add .

$stagedFiles = @(git diff --cached --name-only)
if ($stagedFiles -contains ".env") {
  git reset -- .env
  throw ".env entrou no stage. Removi do stage e parei para nao subir segredo."
}

if ($stagedFiles.Count -gt 0) {
  git commit -m $commitMessage
} else {
  Write-Host "Nada novo para commitar."
}

git push -u origin main
