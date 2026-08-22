# ai-diary Game Session Tracker
#
# Playniteのゲーム終了イベント(OnGameStopped)を検知し、そのセッションの
# ゲーム名・プラットフォーム・開始/終了時刻をai-diaryのCloud Functions
# (recordPlayniteSession)にHTTPS POSTする。設定は以下のJSONファイルから読む
# (このリポジトリにはコミットしない。README.md参照):
#
#   %APPDATA%\AiDiaryPlaynite\config.json
#   {
#     "endpointUrl": "https://asia-northeast1-hakatadiary.cloudfunctions.net/recordPlayniteSession",
#     "ingestToken": "(/data-sources の Playnite カードで発行したトークン)"
#   }
#
# PowerShell 5.1限定(Playniteのスクリプティング仕様)のため、`??` や三項演算子など
# PowerShell 7以降の構文は使わない。

$script:AiDiaryConfigPath = Join-Path $env:APPDATA 'AiDiaryPlaynite\config.json'

function OnGameStopped {
	param($evtArgs)

	try {
		$elapsedSeconds = [int]$evtArgs.ElapsedSeconds
		if ($elapsedSeconds -le 0) {
			# 起動直後に落ちた等、意味のあるプレイ時間がない場合は送信しない。
			return
		}

		if (-not (Test-Path $script:AiDiaryConfigPath)) {
			Write-Host "[AiDiaryPlaynite] Config file not found: $script:AiDiaryConfigPath"
			return
		}
		$config = Get-Content -Path $script:AiDiaryConfigPath -Raw | ConvertFrom-Json
		if (-not $config.endpointUrl -or -not $config.ingestToken) {
			Write-Host '[AiDiaryPlaynite] Config is missing endpointUrl or ingestToken.'
			return
		}

		$game = $evtArgs.Game
		$sourceName = $null
		if ($game.Source) {
			$sourceName = $game.Source.Name
		}

		$endAt = (Get-Date).ToUniversalTime()
		$startAt = $endAt.AddSeconds(-$elapsedSeconds)

		$payload = @{
			gameId         = $game.Id.ToString()
			gameName       = $game.Name
			source         = $sourceName
			startAt        = $startAt.ToString('o')
			endAt          = $endAt.ToString('o')
			elapsedSeconds = $elapsedSeconds
		} | ConvertTo-Json

		Invoke-RestMethod `
			-Uri $config.endpointUrl `
			-Method Post `
			-Headers @{Authorization = "Bearer $($config.ingestToken)" } `
			-ContentType 'application/json; charset=utf-8' `
			-Body ([System.Text.Encoding]::UTF8.GetBytes($payload)) `
			-TimeoutSec 10 | Out-Null

		Write-Host "[AiDiaryPlaynite] Recorded session: $($game.Name) ($elapsedSeconds sec)"
	} catch {
		# ネットワーク不通・サーバーエラーでもPlaynite本体の動作に影響を与えないよう、
		# 例外は握りつぶしログのみ残す(再送キューは未実装。ADR-0012参照)。
		Write-Host "[AiDiaryPlaynite] Failed to record session: $_"
	}
}

Export-ModuleMember -Function OnGameStopped
