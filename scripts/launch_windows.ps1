$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$HostName = "127.0.0.1"
$Port = if ($env:APP_PORT) { $env:APP_PORT } else { "4174" }
$Url = "http://${HostName}:${Port}"

function Write-LauncherLog {
    param([string] $Message)
    Write-Host "[ait-launcher] $Message"
}

function Stop-WithMessage {
    param([string] $Message)
    Write-Host ""
    Write-Host "[ait-launcher] ERROR: $Message" -ForegroundColor Red
    exit 1
}

function Test-PythonCandidate {
    param(
        [string] $Command,
        [string[]] $Arguments
    )
    if (-not $Command) { return $false }
    try {
        & $Command @Arguments -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 7) else 1)" *> $null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function Get-PythonCommand {
    $Candidates = @()
    if ($env:PYTHON) {
        $Candidates += @{ Command = $env:PYTHON; Arguments = @() }
    }
    $Candidates += @{ Command = "python"; Arguments = @() }
    $Candidates += @{ Command = "python3"; Arguments = @() }
    $Candidates += @{ Command = "py"; Arguments = @("-3") }

    foreach ($Candidate in $Candidates) {
        if (Test-PythonCandidate -Command $Candidate.Command -Arguments $Candidate.Arguments) {
            return $Candidate
        }
    }
    return $null
}

function Invoke-Python {
    param(
        [hashtable] $Candidate,
        [string[]] $Arguments
    )
    & $Candidate.Command @($Candidate.Arguments + $Arguments)
}

function Ensure-PortAvailable {
    try {
        $Listener = Get-NetTCPConnection -LocalPort ([int]$Port) -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($Listener) {
            try {
                $Process = Get-Process -Id $Listener.OwningProcess -ErrorAction Stop
                $Owner = "$($Process.ProcessName) (PID $($Listener.OwningProcess))"
            } catch {
                $Owner = "PID $($Listener.OwningProcess)"
            }
            Stop-WithMessage "Port $Port is already in use by $Owner. Stop the existing server first and relaunch."
        }
    } catch {
        # Get-NetTCPConnection not available; skip check
    }
}

$PythonCandidate = Get-PythonCommand
if (-not $PythonCandidate) {
    Stop-WithMessage "Python 3.7 or newer was not found. Install Python from https://www.python.org (check 'Add to PATH'), then relaunch."
}

Ensure-PortAvailable

Write-LauncherLog "Serving AIT Procedure Runner at $Url"
Write-LauncherLog "Press Control-C to stop the server."

$ReadyJob = Start-Job -ScriptBlock {
    param([string] $HostName, [int] $PortNum, [string] $BrowserUrl)
    for ($i = 0; $i -lt 30; $i++) {
        try {
            $tcp = New-Object System.Net.Sockets.TcpClient
            $tcp.Connect($HostName, $PortNum)
            $tcp.Close()
            Start-Process $BrowserUrl
            break
        } catch {
            Start-Sleep -Seconds 1
        }
    }
} -ArgumentList $HostName, ([int]$Port), $Url

try {
    Invoke-Python -Candidate $PythonCandidate -Arguments @("-m", "http.server", $Port, "--bind", $HostName, "--directory", $RepoRoot)
    $ExitCode = $LASTEXITCODE
} finally {
    if ($ReadyJob.State -eq "Running") { Stop-Job $ReadyJob | Out-Null }
    Remove-Job $ReadyJob -Force | Out-Null
}

exit $ExitCode
