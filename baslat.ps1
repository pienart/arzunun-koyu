# Arzu'nun Köyü - bağımlılıksız yerel sunucu (yalnızca Windows PowerShell gerekir)
# baslat.bat, Python veya Node.js bulamazsa bu betiği çalıştırır.
$port = 8080
$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path)) + [System.IO.Path]::DirectorySeparatorChar
$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.webp' = 'image/webp'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.mp3' = 'audio/mpeg'
  '.json' = 'application/json'; '.md' = 'text/plain; charset=utf-8'; '.svg' = 'image/svg+xml'
}
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
try { $listener.Start() } catch {
  Write-Host "Port $port kullanımda olabilir. Başka bir pencerede sunucu açıksa kapatın." -ForegroundColor Red
  Read-Host "Çıkmak için Enter"; exit 1
}
Write-Host "Arzu'nun Köyü çalışıyor: http://localhost:$port/   (kapatmak için bu pencereyi kapatın)" -ForegroundColor Green
Start-Process "http://localhost:$port/"
while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if ([string]::IsNullOrEmpty($rel)) { $rel = 'index.html' }
    $full = [System.IO.Path]::GetFullPath((Join-Path $root $rel))
    if ($full.StartsWith($root) -and (Test-Path $full -PathType Leaf)) {
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      $ctx.Response.ContentType = $(if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' })
      $ctx.Response.Headers.Add('Cache-Control', 'no-cache')
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
    }
    $ctx.Response.Close()
  } catch { }
}
