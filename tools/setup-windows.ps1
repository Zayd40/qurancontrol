$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Run-Checked([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Executable failed with exit code $LASTEXITCODE" }
}

try {
    if (!(Get-Command node -ErrorAction SilentlyContinue)) {
        throw 'Install Node.js 22 LTS from https://nodejs.org then reopen this setup.'
    }
    Run-Checked 'node' @('-e', "if(Number(process.versions.node.split('.')[0]) < 20) process.exit(1)")
    if (!(Test-Path '.venv\Scripts\python.exe')) {
        if (!(Get-Command py -ErrorAction SilentlyContinue)) {
            throw 'Install Python 3.11 (including the Python launcher) from https://www.python.org/downloads/windows/ then reopen setup.'
        }
        Run-Checked 'py' @('-3.11', '-m', 'venv', '.venv')
    }
    $Python = Join-Path (Get-Location) '.venv\Scripts\python.exe'
    Run-Checked 'npm.cmd' @('ci')
    Run-Checked $Python @('-m', 'pip', 'install', '--upgrade', 'pip')
    # CUDA wheels include the CUDA runtime. A current NVIDIA driver is required;
    # the full CUDA development toolkit is not needed.
    Run-Checked $Python @('-m', 'pip', 'install', 'torch==2.7.1', '--index-url', 'https://download.pytorch.org/whl/cu126')
    Run-Checked $Python @('-m', 'pip', 'install', '-r', 'listener/requirements.txt')
    Run-Checked $Python @('-c', "import torch; print('GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'unavailable'); assert torch.cuda.is_available(), 'Update the NVIDIA driver and rerun setup; CUDA GPU is unavailable.'")
    Write-Host 'Downloading speech models. Internet is needed for this first setup.'
    Run-Checked $Python @('listener/worker.py', '--prepare')
    Run-Checked 'npm.cmd' @('run', 'check')
    Run-Checked $Python @('-m', 'unittest', 'discover', '-s', 'listener', '-p', 'test_*.py')
    Write-Host 'Ready. Use Start-QuranControl.cmd, choose the mixer input in Audio settings, then press Go.'
} catch {
    Write-Host $_ -ForegroundColor Red
    exit 1
}
