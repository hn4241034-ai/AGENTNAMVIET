param(
    [int]$Port = 8765
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.Web

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PublicDir = Join-Path $RootDir "public"
$ConfigPath = Join-Path $RootDir "config\business_rules.json"
$BrainsPath = Join-Path $RootDir "config\llm_brains.json"
$LogsDir = Join-Path $RootDir "logs"
if (-not (Test-Path $LogsDir)) { New-Item -ItemType Directory -Path $LogsDir | Out-Null }

function Get-MimeType($ext) {
    switch ($ext.ToLower()) {
        ".html" { "text/html; charset=utf-8" }
        ".css"  { "text/css; charset=utf-8" }
        ".js"   { "application/javascript; charset=utf-8" }
        ".json" { "application/json; charset=utf-8" }
        ".csv"  { "text/csv; charset=utf-8" }
        ".svg"  { "image/svg+xml" }
        ".png"  { "image/png" }
        ".jpg"  { "image/jpeg" }
        default { "application/octet-stream" }
    }
}

function Send-JsonResponse($response, $obj, [int]$statusCode = 200) {
    $json = $obj | ConvertTo-Json -Depth 12 -Compress:$false
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $response.StatusCode = $statusCode
    $response.ContentType = "application/json; charset=utf-8"
    $response.Headers.Add("Access-Control-Allow-Origin", "*")
    $response.ContentLength64 = $bytes.Length
    $response.OutputStream.Write($bytes, 0, $bytes.Length)
    $response.OutputStream.Close()
}

function Send-TextResponse($response, [string]$text, [string]$contentType = "text/plain; charset=utf-8", [int]$statusCode = 200) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
    $response.StatusCode = $statusCode
    $response.ContentType = $contentType
    $response.Headers.Add("Access-Control-Allow-Origin", "*")
    $response.ContentLength64 = $bytes.Length
    $response.OutputStream.Write($bytes, 0, $bytes.Length)
    $response.OutputStream.Close()
}

function Read-RequestBody($request) {
    $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
    $body = $reader.ReadToEnd()
    $reader.Close()
    return $body
}

function Convert-ColLettersToIndex([string]$colRef) {
    $letters = ($colRef -replace '[0-9]', '').ToUpper()
    $index = 0
    foreach ($ch in $letters.ToCharArray()) {
        $index = $index * 26 + ([int][char]$ch - [int][char]'A' + 1)
    }
    return $index - 1
}

function Parse-XlsxBytes([byte[]]$bytes) {
    $tempFile = [System.IO.Path]::GetTempFileName() + ".xlsx"
    [System.IO.File]::WriteAllBytes($tempFile, $bytes)
    $zip = $null
    try {
        $zip = [System.IO.Compression.ZipFile]::OpenRead($tempFile)
        
        # 1. Read sharedStrings.xml if present
        $sharedStrings = New-Object System.Collections.Generic.List[string]
        $ssEntry = $zip.GetEntry("xl/sharedStrings.xml")
        if ($ssEntry) {
            $sr = New-Object System.IO.StreamReader($ssEntry.Open(), [System.Text.Encoding]::UTF8)
            [xml]$ssXml = $sr.ReadToEnd()
            $sr.Close()
            foreach ($si in $ssXml.sst.si) {
                if ($si.t) {
                    if ($si.t -is [System.Xml.XmlElement]) { $sharedStrings.Add($si.t.InnerText) }
                    else { $sharedStrings.Add([string]$si.t) }
                } elseif ($si.r) {
                    $sb = New-Object System.Text.StringBuilder
                    foreach ($run in $si.r) {
                        if ($run.t) {
                            if ($run.t -is [System.Xml.XmlElement]) { [void]$sb.Append($run.t.InnerText) }
                            else { [void]$sb.Append([string]$run.t) }
                        }
                    }
                    $sharedStrings.Add($sb.ToString())
                } else {
                    $sharedStrings.Add("")
                }
            }
        }

        # 2. Read workbook.xml & rels to map sheet names -> paths
        $wbEntry = $zip.GetEntry("xl/workbook.xml")
        $relsEntry = $zip.GetEntry("xl/_rels/workbook.xml.rels")
        $sheetList = New-Object System.Collections.Generic.List[object]

        if ($wbEntry -and $relsEntry) {
            $srWb = New-Object System.IO.StreamReader($wbEntry.Open(), [System.Text.Encoding]::UTF8)
            [xml]$wbXml = $srWb.ReadToEnd()
            $srWb.Close()

            $srRel = New-Object System.IO.StreamReader($relsEntry.Open(), [System.Text.Encoding]::UTF8)
            [xml]$relXml = $srRel.ReadToEnd()
            $srRel.Close()

            $relMap = @{}
            foreach ($rel in $relXml.Relationships.Relationship) {
                $target = [string]$rel.Target
                $target = $target.TrimStart('/')
                if (-not $target.StartsWith("xl/")) {
                    $target = "xl/" + $target
                }
                $relMap[$rel.Id] = $target
            }

            foreach ($sheet in $wbXml.workbook.sheets.sheet) {
                $rid = $null
                if ($sheet.Attributes["r:id"]) { $rid = $sheet.Attributes["r:id"].Value }
                elseif ($sheet.id) { $rid = $sheet.id }
                if ($rid -and $relMap.ContainsKey($rid)) {
                    $sheetList.Add(@{ name = $sheet.name; path = $relMap[$rid] })
                }
            }
        }

        if ($sheetList.Count -eq 0) {
            $sheetList.Add(@{ name = "Sheet1"; path = "xl/worksheets/sheet1.xml" })
        }

        $resultSheets = [ordered]@{}
        foreach ($sh in $sheetList) {
            $entry = $zip.GetEntry($sh.path)
            if (-not $entry) { continue }
            $srSh = New-Object System.IO.StreamReader($entry.Open(), [System.Text.Encoding]::UTF8)
            [xml]$shXml = $srSh.ReadToEnd()
            $srSh.Close()

            $rows = New-Object System.Collections.Generic.List[object]
            $maxCol = 0
            if ($shXml.worksheet.sheetData.row) {
                foreach ($rowNode in $shXml.worksheet.sheetData.row) {
                    $rowMap = @{}
                    foreach ($c in $rowNode.c) {
                        $colIdx = Convert-ColLettersToIndex $c.r
                        if ($colIdx -gt $maxCol) { $maxCol = $colIdx }
                        $val = ""
                        $cellType = $c.t
                        if ($cellType -eq "s" -and $c.v -ne $null) {
                            $idx = [int]$c.v
                            if ($idx -ge 0 -and $idx -lt $sharedStrings.Count) {
                                $val = $sharedStrings[$idx]
                            }
                        } elseif ($cellType -eq "inlineStr" -and $c.is) {
                            $val = $c.is.InnerText
                        } elseif ($cellType -eq "str" -and $c.v -ne $null) {
                            $val = [string]$c.v
                        } elseif ($c.v -ne $null) {
                            $val = [string]$c.v
                        }
                        $rowMap[$colIdx] = $val
                    }
                    $rows.Add($rowMap)
                }
            }

            # Convert to 2D arrays
            $matrix = New-Object System.Collections.Generic.List[object]
            foreach ($rm in $rows) {
                $arr = New-Object string[] ($maxCol + 1)
                for ($i = 0; $i -le $maxCol; $i++) {
                    if ($rm.ContainsKey($i)) { $arr[$i] = $rm[$i] } else { $arr[$i] = "" }
                }
                $matrix.Add($arr)
            }
            $resultSheets[$sh.name] = $matrix
        }
        return $resultSheets
    } finally {
        if ($zip) { $zip.Dispose() }
        if (Test-Path $tempFile) { Remove-Item $tempFile -Force -ErrorAction SilentlyContinue }
    }
}

$listener = New-Object System.Net.HttpListener
$prefix = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)
$listener.Start()

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Minh Hoang AI Sales Lead Agent Server running at:" -ForegroundColor Green
Write-Host "  $prefix" -ForegroundColor Yellow
Write-Host "  Press Ctrl+C to stop." -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        $path = $request.Url.AbsolutePath

        try {
            if ($request.HttpMethod -eq "OPTIONS") {
                $response.Headers.Add("Access-Control-Allow-Origin", "*")
                $response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                $response.Headers.Add("Access-Control-Allow-Headers", "Content-Type, Authorization")
                $response.StatusCode = 204
                $response.OutputStream.Close()
                continue
            }

            if ($path -eq "/api/health" -and $request.HttpMethod -eq "GET") {
                Send-JsonResponse $response @{
                    status = "ok"
                    service = "NamViet AI Agent Server"
                    time = (Get-Date).ToString("o")
                    logs_dir = $LogsDir
                }
                continue
            }

            if ($path -eq "/api/config" -and $request.HttpMethod -eq "GET") {
                $cfgRaw = Get-Content $ConfigPath -Raw -Encoding UTF8
                Send-TextResponse $response $cfgRaw "application/json; charset=utf-8" 200
                continue
            }

            if ($path -eq "/api/config" -and $request.HttpMethod -eq "POST") {
                $body = Read-RequestBody $request
                $parsed = $body | ConvertFrom-Json
                $pretty = $parsed | ConvertTo-Json -Depth 12
                [System.IO.File]::WriteAllText($ConfigPath, $pretty, [System.Text.Encoding]::UTF8)
                Send-JsonResponse $response @{ ok = $true; message = "Đã cập nhật cấu hình quy tắc nghiệp vụ." }
                continue
            }

            if ($path -eq "/api/parse-xlsx" -and $request.HttpMethod -eq "POST") {
                $body = Read-RequestBody $request | ConvertFrom-Json
                $bytes = [System.Convert]::FromBase64String($body.base64)
                $sheets = Parse-XlsxBytes $bytes
                Send-JsonResponse $response @{ ok = $true; filename = $body.filename; sheets = $sheets }
                continue
            }

            if ($path -eq "/api/fetch-gsheet" -and $request.HttpMethod -eq "POST") {
                $body = Read-RequestBody $request | ConvertFrom-Json
                $url = [string]$body.url
                if ($url -notmatch "docs\.google\.com/spreadsheets/d/([a-zA-Z0-9_-]+)") {
                    Send-JsonResponse $response @{ ok = $false; error = "URL không phải link Google Sheets hợp lệ (cần dạng https://docs.google.com/spreadsheets/d/...)." } 400
                    continue
                }
                $sheetId = $Matches[1]
                $gid = "0"
                if ($url -match "gid=([0-9]+)") { $gid = $Matches[1] }

                $wc = New-Object System.Net.WebClient
                $wc.Encoding = [System.Text.Encoding]::UTF8
                $wc.Headers.Add("User-Agent", "Mozilla/5.0 NamVietLeadAgent/1.0")

                try {
                    # Try XLSX export first to preserve all sheets if workbook is shared
                    $xlsxUrl = "https://docs.google.com/spreadsheets/d/$sheetId/export?format=xlsx"
                    $xlsxBytes = $wc.DownloadData($xlsxUrl)
                    # Check ZIP magic bytes PK (0x50 0x4B)
                    if ($xlsxBytes.Length -gt 4 -and $xlsxBytes[0] -eq 0x50 -and $xlsxBytes[1] -eq 0x4B) {
                        $sheets = Parse-XlsxBytes $xlsxBytes
                        Send-JsonResponse $response @{ ok = $true; mode = "xlsx_export"; sheetId = $sheetId; sheets = $sheets }
                        continue
                    }
                } catch {
                    # Fallback to CSV export for specific gid
                }

                try {
                    $csvUrl = "https://docs.google.com/spreadsheets/d/$sheetId/export?format=csv&gid=$gid"
                    $csvText = $wc.DownloadString($csvUrl)
                    if ($csvText -match "<!DOCTYPE html" -or $csvText -match "ServiceLogin") {
                        Send-JsonResponse $response @{ ok = $false; error = "Google Sheet đang ở chế độ riêng tư. Vui lòng bật quyền 'Bất kỳ ai có đường liên kết đều có thể xem'." } 403
                        continue
                    }
                    Send-JsonResponse $response @{ ok = $true; mode = "csv_export"; sheetId = $sheetId; csv = $csvText }
                } catch {
                    Send-JsonResponse $response @{ ok = $false; error = "Không tải được Google Sheet: $($_.Exception.Message). Hãy kiểm tra quyền chia sẻ công khai." } 502
                }
                continue
            }

            if ($path -eq "/api/save-log" -and $request.HttpMethod -eq "POST") {
                $body = Read-RequestBody $request | ConvertFrom-Json
                $runId = ($body.run_id -replace '[^a-zA-Z0-9_-]', '')
                if (-not $runId) { $runId = (Get-Date).ToString("yyyyMMdd_HHmmss") }
                $logFile = Join-Path $LogsDir "trace_$runId.jsonl"
                $lines = New-Object System.Collections.Generic.List[string]
                foreach ($evt in $body.events) {
                    $lines.Add(($evt | ConvertTo-Json -Depth 10 -Compress))
                }
                [System.IO.File]::WriteAllLines($logFile, $lines, [System.Text.Encoding]::UTF8)
                Send-JsonResponse $response @{ ok = $true; file = "logs/trace_$runId.jsonl"; count = $lines.Count }
                continue
            }

            if ($path -eq "/api/logs" -and $request.HttpMethod -eq "GET") {
                $files = Get-ChildItem $LogsDir -Filter "*.jsonl" | Sort-Object LastWriteTime -Descending | Select-Object Name, Length, @{Name="LastWriteTime";Expression={$_.LastWriteTime.ToString("o")}}
                Send-JsonResponse $response @{ ok = $true; files = @($files) }
                continue
            }

            if ($path.StartsWith("/api/logs/") -and $request.HttpMethod -eq "GET") {
                $fname = [System.IO.Path]::GetFileName($path.Substring(10))
                $fpath = Join-Path $LogsDir $fname
                if (Test-Path $fpath) {
                    $txt = Get-Content $fpath -Raw -Encoding UTF8
                    Send-TextResponse $response $txt "text/plain; charset=utf-8" 200
                } else {
                    Send-JsonResponse $response @{ ok = $false; error = "Log file not found" } 404
                }
                continue
            }

function Mask-ApiKey([string]$key) {
    if (-not $key) { return "" }
    if ($key.Length -le 12) { return "****" }
    return $key.Substring(0, 8) + "..." + $key.Substring($key.Length - 5)
}

function Load-BrainsConfig {
    if (Test-Path $BrainsPath) {
        return (Get-Content $BrainsPath -Raw -Encoding UTF8 | ConvertFrom-Json)
    }
    return @{ enabled = $false; brains = @(); primary_model = "gemini-3.5-flash-lite"; fallback_models = @(); endpoint = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"; timeout_seconds = 25 }
}

function Strip-ThoughtTags([string]$text) {
    if (-not $text) { return "" }
    return ([regex]::Replace($text, '(?s)<thought>.*?</thought>\s*', '')).Trim()
}

function Invoke-SingleBrainCall([string]$endpoint, [string]$apiKey, [string]$model, $messages, [double]$temperature = 0.2, [int]$timeoutSec = 25) {
    $hc = New-Object System.Net.Http.HttpClient
    $hc.Timeout = [TimeSpan]::FromSeconds($timeoutSec)
    $payloadObj = @{
        model = $model
        temperature = $temperature
        messages = $messages
    }
    $payloadJson = $payloadObj | ConvertTo-Json -Depth 12 -Compress
    $req = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Post, $endpoint)
    $req.Headers.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", $apiKey)
    $req.Content = New-Object System.Net.Http.StringContent($payloadJson, [System.Text.Encoding]::UTF8, "application/json")
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $res = $hc.SendAsync($req).Result
    $resBody = $res.Content.ReadAsStringAsync().Result
    $sw.Stop()
    return @{
        statusCode = [int]$res.StatusCode
        body = $resBody
        latencyMs = $sw.ElapsedMilliseconds
    }
}

function Invoke-DualBrainFailover($messages, [double]$temperature = 0.2) {
    $cfg = Load-BrainsConfig
    if (-not $cfg.enabled) {
        return @{ ok = $false; error = "LLM Brains đang tắt." }
    }
    $activeBrains = @($cfg.brains | Where-Object { $_.active -and $_.api_key })
    if ($activeBrains.Count -eq 0) {
        return @{ ok = $false; error = "Không có API Key nào đang kích hoạt." }
    }
    $models = @($cfg.primary_model) + @($cfg.fallback_models) | Where-Object { $_ } | Select-Object -Unique
    $timeoutSec = if ($cfg.timeout_seconds) { [int]$cfg.timeout_seconds } else { 25 }
    $attempts = New-Object System.Collections.Generic.List[object]

    foreach ($model in $models) {
        foreach ($brain in $activeBrains) {
            try {
                $r = Invoke-SingleBrainCall $cfg.endpoint $brain.api_key $model $messages $temperature $timeoutSec
                if ($r.statusCode -ge 200 -and $r.statusCode -lt 300) {
                    $parsed = $r.body | ConvertFrom-Json
                    $rawContent = [string]$parsed.choices[0].message.content
                    $cleanContent = Strip-ThoughtTags $rawContent
                    $attempts.Add(@{ brain = $brain.id; model = $model; status = $r.statusCode; latency_ms = $r.latencyMs })
                    return @{
                        ok = $true
                        brain_id = $brain.id
                        brain_label = $brain.label
                        model_used = $model
                        latency_ms = $r.latencyMs
                        usage = $parsed.usage
                        content = $cleanContent
                        attempts = $attempts.ToArray()
                    }
                } else {
                    $attempts.Add(@{ brain = $brain.id; model = $model; status = $r.statusCode; error = $r.body.Substring(0, [Math]::Min(180, $r.body.Length)) })
                }
            } catch {
                $attempts.Add(@{ brain = $brain.id; model = $model; status = 0; error = $_.Exception.Message })
            }
        }
    }
    return @{ ok = $false; error = "Tất cả bộ não API đều thất bại hoặc quá tải."; attempts = $attempts.ToArray() }
}

            if ($path -eq "/api/brains" -and $request.HttpMethod -eq "GET") {
                $cfg = Load-BrainsConfig
                $maskedBrains = @($cfg.brains | ForEach-Object {
                    @{
                        id = $_.id
                        label = $_.label
                        masked_key = Mask-ApiKey $_.api_key
                        active = [bool]$_.active
                    }
                })
                Send-JsonResponse $response @{
                    ok = $true
                    enabled = [bool]$cfg.enabled
                    provider = $cfg.provider
                    endpoint = $cfg.endpoint
                    primary_model = $cfg.primary_model
                    fallback_models = @($cfg.fallback_models)
                    brains = $maskedBrains
                }
                continue
            }

            if ($path -eq "/api/brains" -and $request.HttpMethod -eq "POST") {
                $reqBody = Read-RequestBody $request | ConvertFrom-Json
                $cfg = Load-BrainsConfig
                if ($null -ne $reqBody.enabled) { $cfg.enabled = [bool]$reqBody.enabled }
                if ($reqBody.primary_model) { $cfg.primary_model = [string]$reqBody.primary_model }
                if ($reqBody.endpoint) { $cfg.endpoint = [string]$reqBody.endpoint }
                if ($reqBody.new_keys) {
                    $newList = New-Object System.Collections.Generic.List[object]
                    $idx = 1
                    foreach ($k in $reqBody.new_keys) {
                        $trimmed = ([string]$k).Trim()
                        if ($trimmed) {
                            $newList.Add(@{ id = "brain_$idx"; label = "Bộ não #$idx"; api_key = $trimmed; active = $true })
                            $idx++
                        }
                    }
                    if ($newList.Count -gt 0) { $cfg.brains = $newList.ToArray() }
                }
                $pretty = $cfg | ConvertTo-Json -Depth 10
                [System.IO.File]::WriteAllText($BrainsPath, $pretty, [System.Text.Encoding]::UTF8)
                Send-JsonResponse $response @{ ok = $true; count = @($cfg.brains).Count }
                continue
            }

            if ($path -eq "/api/brains/test" -and $request.HttpMethod -eq "POST") {
                $cfg = Load-BrainsConfig
                $results = New-Object System.Collections.Generic.List[object]
                $modelsToTry = @($cfg.primary_model) + @($cfg.fallback_models) | Where-Object { $_ } | Select-Object -Unique
                foreach ($b in $cfg.brains) {
                    $tested = $null
                    foreach ($m in $modelsToTry) {
                        try {
                            $r = Invoke-SingleBrainCall $cfg.endpoint $b.api_key $m @(@{ role = "user"; content = "Reply with OK" }) 0.0 20
                            if ($r.statusCode -ge 200 -and $r.statusCode -lt 300) {
                                $parsed = $r.body | ConvertFrom-Json
                                $txt = Strip-ThoughtTags ([string]$parsed.choices[0].message.content)
                                $tested = @{ id = $b.id; label = $b.label; masked_key = (Mask-ApiKey $b.api_key); ok = $true; model = $m; latency_ms = $r.latencyMs; reply = $txt }
                                break
                            }
                        } catch {}
                    }
                    if (-not $tested) {
                        $tested = @{ id = $b.id; label = $b.label; masked_key = (Mask-ApiKey $b.api_key); ok = $false; error = "Không phản hồi" }
                    }
                    $results.Add($tested)
                }
                Send-JsonResponse $response @{ ok = $true; results = $results.ToArray() }
                continue
            }

            if ($path -eq "/api/agent-llm" -and $request.HttpMethod -eq "POST") {
                $body = Read-RequestBody $request | ConvertFrom-Json
                $temp = if ($null -ne $body.temperature) { [double]$body.temperature } else { 0.2 }
                $llmRes = Invoke-DualBrainFailover $body.messages $temp
                $code = if ($llmRes.ok) { 200 } else { 502 }
                Send-JsonResponse $response $llmRes $code
                continue
            }

            if ($path -eq "/api/llm-proxy" -and $request.HttpMethod -eq "POST") {
                $body = Read-RequestBody $request | ConvertFrom-Json
                $endpoint = [string]$body.endpoint
                $apiKey = [string]$body.apiKey
                $payloadJson = $body.payload | ConvertTo-Json -Depth 12 -Compress

                $httpClient = New-Object System.Net.Http.HttpClient
                $httpClient.Timeout = [TimeSpan]::FromSeconds(60)
                if ($apiKey) {
                    $httpClient.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", $apiKey)
                }
                $content = New-Object System.Net.Http.StringContent($payloadJson, [System.Text.Encoding]::UTF8, "application/json")
                $res = $httpClient.PostAsync($endpoint, $content).Result
                $resBody = $res.Content.ReadAsStringAsync().Result
                Send-TextResponse $response $resBody "application/json; charset=utf-8" ([int]$res.StatusCode)
                continue
            }

            # Static files (public/, config/, data/)
            $relPath = $path.TrimStart('/')
            if ($relPath -eq "" -or $relPath -eq "/") { $relPath = "index.html" }

            if ($relPath -eq "config/llm_brains.json") {
                Send-TextResponse $response "403 Forbidden" "text/plain; charset=utf-8" 403
                continue
            }
            $candidate = Join-Path $PublicDir $relPath
            if ($relPath.StartsWith("data/")) {
                $candidate = Join-Path $RootDir $relPath
            } elseif ($relPath.StartsWith("config/")) {
                $candidate = Join-Path $RootDir $relPath
            }

            if (Test-Path $candidate -PathType Leaf) {
                $ext = [System.IO.Path]::GetExtension($candidate)
                $mime = Get-MimeType $ext
                $fileBytes = [System.IO.File]::ReadAllBytes($candidate)
                $response.StatusCode = 200
                $response.ContentType = $mime
                $response.ContentLength64 = $fileBytes.Length
                $response.OutputStream.Write($fileBytes, 0, $fileBytes.Length)
                $response.OutputStream.Close()
            } else {
                Send-TextResponse $response "404 Not Found: $relPath" "text/plain; charset=utf-8" 404
            }
        } catch {
            try {
                Send-JsonResponse $response @{ ok = $false; error = $_.Exception.Message } 500
            } catch {}
        }
    }
} finally {
    $listener.Stop()
    $listener.Close()
}
