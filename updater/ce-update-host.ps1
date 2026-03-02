# ============================================================
# Ccofolia Extension — Native Messaging Host (PowerShell)
# Chrome NM Protocol: 4-byte LE uint32 length + UTF-8 JSON
# ============================================================

$ErrorActionPreference = 'Stop'

# ── Read one native message from stdin ──────────────────────

function Read-NativeMessage {
    $stdin = [System.Console]::OpenStandardInput()

    # Read 4-byte message length (little-endian uint32)
    $lengthBytes = New-Object byte[] 4
    $bytesRead = $stdin.Read($lengthBytes, 0, 4)
    if ($bytesRead -lt 4) { return $null }

    $length = [System.BitConverter]::ToInt32($lengthBytes, 0)
    if ($length -le 0 -or $length -gt 1048576) { return $null }

    # Read JSON message body
    $msgBytes = New-Object byte[] $length
    $totalRead = 0
    while ($totalRead -lt $length) {
        $read = $stdin.Read($msgBytes, $totalRead, $length - $totalRead)
        if ($read -eq 0) { return $null }
        $totalRead += $read
    }

    return [System.Text.Encoding]::UTF8.GetString($msgBytes) | ConvertFrom-Json
}

# ── Write one native message to stdout ──────────────────────

function Write-NativeMessage($obj) {
    $json = $obj | ConvertTo-Json -Compress -Depth 10
    $msgBytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $stdout = [System.Console]::OpenStandardOutput()
    $lengthBytes = [System.BitConverter]::GetBytes([int]$msgBytes.Length)
    $stdout.Write($lengthBytes, 0, 4)
    $stdout.Write($msgBytes, 0, $msgBytes.Length)
    $stdout.Flush()
}

# ── Main ────────────────────────────────────────────────────

$message = Read-NativeMessage
if (-not $message) { exit 1 }

# Extension root = one level above updater/ folder
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$extensionRoot = Split-Path -Parent $scriptDir

switch ($message.command) {
    'ping' {
        Write-NativeMessage @{
            success = $true
            pong    = $true
            path    = $extensionRoot
        }
    }

    'git-pull' {
        try {
            Push-Location $extensionRoot
            $output = & git pull 2>&1 | Out-String
            $exitCode = $LASTEXITCODE
            Pop-Location

            Write-NativeMessage @{
                success  = ($exitCode -eq 0)
                output   = $output.Trim()
                exitCode = $exitCode
            }
        }
        catch {
            Write-NativeMessage @{
                success  = $false
                output   = $_.Exception.Message
                exitCode = -1
            }
        }
    }

    default {
        Write-NativeMessage @{
            success = $false
            output  = "Unknown command: $($message.command)"
        }
    }
}
