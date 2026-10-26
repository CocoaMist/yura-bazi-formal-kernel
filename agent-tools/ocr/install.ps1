$ErrorActionPreference = 'Stop'
$toolRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvPath = Join-Path $toolRoot '.venv'
$pythonPath = Join-Path $venvPath 'Scripts\python.exe'
$lockPath = Join-Path $toolRoot 'requirements.lock.txt'

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  throw 'uv is required to create the isolated OCR runtime.'
}

uv venv $venvPath --python 3.12
uv pip sync --python $pythonPath $lockPath
$env:OMP_NUM_THREADS = '2'
$env:OPENBLAS_NUM_THREADS = '2'
& $pythonPath (Join-Path $toolRoot 'ocr.py') status --require-gpu
