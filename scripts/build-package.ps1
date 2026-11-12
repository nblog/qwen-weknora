param(
    [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 3.0

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Version = (Get-Content -LiteralPath (Join-Path $Root "package.json") -Raw | ConvertFrom-Json).version
$OutputRoot = Join-Path $Root "release"
$StagingRoot = Join-Path $Root "dist-package"
$Stage = Join-Path $StagingRoot "weknora-agent-plugin"
$ZipPath = Join-Path $OutputRoot "weknora-agent-plugin-$Version.zip"
$ManifestPath = Join-Path $OutputRoot "weknora-agent-plugin-$Version.manifest.json"
$ChecksumPath = Join-Path $OutputRoot "weknora-agent-plugin-$Version.zip.sha256"

function Assert-WithinRoot {
    param([string]$Target, [string]$Base)
    $fullTarget = [System.IO.Path]::GetFullPath($Target)
    $fullBase = [System.IO.Path]::GetFullPath($Base).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $fullTarget.StartsWith($fullBase, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify a path outside the workspace: $fullTarget"
    }
}

foreach ($path in @($OutputRoot, $StagingRoot)) {
    Assert-WithinRoot -Target $path -Base $Root
    if (Test-Path -LiteralPath $path) {
        Remove-Item -LiteralPath $path -Recurse -Force
    }
}
New-Item -ItemType Directory -Path $Stage, $OutputRoot | Out-Null

Push-Location $Root
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE" }

    $files = @(
        "plugin.json",
        "mcp.json",
        "package.json",
        "README.md",
        "README_zh-CN.md",
        "LICENSE",
        "NOTICE",
        "skills/weknora/SKILL.md",
        "dist/server.js",
        "schemas/config.schema.json",
        "examples/config.example.json"
    )

    foreach ($relative in $files) {
        $source = Join-Path $Root $relative
        $destination = Join-Path $Stage $relative
        Assert-WithinRoot -Target $source -Base $Root
        Assert-WithinRoot -Target $destination -Base $Stage
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination
    }

    $actualFiles = Get-ChildItem -LiteralPath $Stage -Recurse -File |
        ForEach-Object { [System.IO.Path]::GetRelativePath($Stage, $_.FullName).Replace([System.IO.Path]::DirectorySeparatorChar, "/") } |
        Sort-Object
    $expectedFiles = $files | Sort-Object
    if (Compare-Object -ReferenceObject $expectedFiles -DifferenceObject $actualFiles) {
        throw "Package staging file list does not match the explicit allowlist."
    }
    foreach ($forbidden in @("node_modules", ".codex-tracking", "config.json", "test", "dist-package")) {
        if ($actualFiles -contains $forbidden -or ($actualFiles | Where-Object { $_.StartsWith("$forbidden/") })) {
            throw "Forbidden package entry detected: $forbidden"
        }
    }

    $manifestFiles = foreach ($relative in $files) {
        $path = Join-Path $Stage $relative
        $item = Get-Item -LiteralPath $path
        [ordered]@{
            path = $relative
            bytes = $item.Length
            sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }

    Compress-Archive -Path (Join-Path $Stage "*") -DestinationPath $ZipPath -Force
    $archiveHash = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $archiveItem = Get-Item -LiteralPath $ZipPath
    $manifest = [ordered]@{
        name = "weknora-agent-plugin"
        version = $Version
        configuration = $Configuration
        created = [DateTimeOffset]::Now.ToString("o")
        archive = [System.IO.Path]::GetFileName($ZipPath)
        archiveBytes = $archiveItem.Length
        archiveSha256 = $archiveHash
        nodeRequirement = ">=22"
        files = $manifestFiles
    }
    $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ManifestPath -Encoding utf8NoBOM
    $archiveHash.ToUpperInvariant() | Set-Content -LiteralPath $ChecksumPath -Encoding ascii

    [pscustomobject]@{
        Version = $Version
        Archive = $ZipPath
        Sha256 = $archiveHash
        Manifest = $ManifestPath
        Files = $files.Count
    }
}
finally {
    Pop-Location
}
