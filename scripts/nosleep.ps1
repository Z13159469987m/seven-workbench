$ErrorActionPreference = 'Continue'

$m = [regex]::Match((powercfg /getactivescheme), 'GUID:\s*([0-9A-Fa-f-]+)')
$guid = $m.Groups[1].Value

function Get-ACSetting {
  param([string]$group, [string]$setting)
  $out = powercfg /query $guid $group $setting 2>$null
  foreach ($line in $out) {
    if ($line -match 'Power Setting Index:\s*0x([0-9A-Fa-f]+)') {
      return [Convert]::ToInt32($matches[1], 16)
    }
    if ($line -match '电源设置索引:\s*0x([0-9A-Fa-f]+)') {
      return [Convert]::ToInt32($matches[1], 16)
    }
  }
  return $null
}

$mon = Get-ACSetting '7516b95f-f776-4464-8c53-06167f40cc99' '3c0bc021-c8a8-4e07-a973-6b14cbcb2b7e'
$sleep = Get-ACSetting '238c9fa8-0aad-41ed-83f4-97be242c8f20' '29f6c1db-86da-48c5-9fdb-f2b67b1f44da'
$hib = Get-ACSetting '238c9fa8-0aad-41ed-83f4-97be242c8f20' '9d7815a6-7ee4-497e-8888-515a05f02364'

if ($null -eq $mon) { $mon = 10 }
if ($null -eq $sleep) { $sleep = 30 }
if ($null -eq $hib) { $hib = 0 }

Write-Host ("Active scheme: {0}" -f $guid)
Write-Host ("Original AC: monitor={0}min sleep={1}min hibernate={2}min" -f $mon, $sleep, $hib)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$restoreBat = Join-Path $scriptDir 'nosleep_restore.bat'
$bat = "@echo off`npowercfg /change monitor-timeout-ac $mon`npowercfg /change standby-timeout-ac $sleep`npowercfg /change hibernate-timeout-ac $hib`n"
Set-Content -Path $restoreBat -Value $bat -Encoding ASCII
Write-Host ("Wrote restore bat: {0}" -f $restoreBat)

powercfg /change monitor-timeout-ac 0
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
Write-Host 'Set AC timeouts to 0 (never sleep / display stays on).'

$recover = (Get-Date).AddHours(3).ToString('HH:mm')
Write-Host ("Auto-recovery at {0}" -f $recover)

schtasks /delete /tn "WB_NoSleep_Recovery" /f 2>$null
schtasks /create /tn "WB_NoSleep_Recovery" /tr "$restoreBat" /sc once /st $recover /rl HIGHEST /f
Write-Host 'Recovery task WB_NoSleep_Recovery created.'

Write-Host ('Now AC: monitor={0} sleep={1} hibernate={2}' -f (Get-ACSetting '7516b95f-f776-4464-8c53-06167f40cc99' '3c0bc021-c8a8-4e07-a973-6b14cbcb2b7e'), (Get-ACSetting '238c9fa8-0aad-41ed-83f4-97be242c8f20' '29f6c1a8-3f83-4cdc-8a93-869bda3287a3'), (Get-ACSetting '238c9fa8-0aad-41ed-83f4-97be242c8f20' '9d7815a6-7ee4-497e-8888-515a05f02364'))
