param(
  [int]$Port = 8080,
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()
Write-Host "Serving $Root at http://localhost:$Port/"

function Get-MimeType([string]$Path) {
  switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
    ".html" { "text/html; charset=utf-8" }
    ".js" { "application/javascript; charset=utf-8" }
    ".css" { "text/css; charset=utf-8" }
    ".json" { "application/json; charset=utf-8" }
    ".png" { "image/png" }
    ".jpg" { "image/jpeg" }
    ".jpeg" { "image/jpeg" }
    ".ico" { "image/x-icon" }
    default { "application/octet-stream" }
  }
}

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
      $requestLine = $reader.ReadLine()
      if (-not $requestLine) { continue }

      while (($line = $reader.ReadLine()) -ne $null -and $line.Length -gt 0) {}

      $parts = $requestLine.Split(" ")
      $urlPath = if ($parts.Length -gt 1) { $parts[1].Split("?")[0] } else { "/" }
      $relative = [Uri]::UnescapeDataString($urlPath.TrimStart("/"))
      if ([string]::IsNullOrWhiteSpace($relative)) { $relative = "index.html" }

      $candidate = Join-Path $Root $relative
      if ((Test-Path -LiteralPath $candidate -PathType Container)) {
        $candidate = Join-Path $candidate "index.html"
      }

      $rootFull = (Resolve-Path $Root).Path
      $exists = Test-Path -LiteralPath $candidate -PathType Leaf
      $insideRoot = $false
      if ($exists) {
        $insideRoot = ((Resolve-Path $candidate).Path).StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)
      }

      if ($exists -and $insideRoot) {
        $body = [System.IO.File]::ReadAllBytes($candidate)
        $header = "HTTP/1.1 200 OK`r`nContent-Type: $(Get-MimeType $candidate)`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
      } else {
        $body = [System.Text.Encoding]::UTF8.GetBytes("Not found")
        $header = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
      }

      $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
      $stream.Write($headerBytes, 0, $headerBytes.Length)
      $stream.Write($body, 0, $body.Length)
    }
    finally {
      $client.Close()
    }
  }
}
finally {
  $listener.Stop()
}
