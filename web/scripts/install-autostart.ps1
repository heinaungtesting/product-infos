# Register the Job OS dashboard as a per-user logon task (no admin needed).
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1   [-Remove]
param([switch]$Remove)
$name = "JobOS Dashboard"
if ($Remove) { Unregister-ScheduledTask -TaskName $name -Confirm:$false; "Removed '$name'"; exit 0 }

$bash = @("$env:ProgramFiles\Git\bin\bash.exe", "${env:ProgramFiles(x86)}\Git\bin\bash.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $bash) { throw "Git Bash not found (needed to run start-dashboard.sh)." }
$script = (Resolve-Path (Join-Path $PSScriptRoot "start-dashboard.sh")).Path -replace '\\', '/'

$action   = New-ScheduledTaskAction -Execute $bash -Argument "-lc `"'$script'`""
$trigger  = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$trigger.Delay = "PT45S"   # let Tailscale and the network come up first
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
"Registered '$name' → $script (at logon, +45s, restarts 3x on failure)"
