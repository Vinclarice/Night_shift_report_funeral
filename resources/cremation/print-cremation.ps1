$ErrorActionPreference = "Stop"
$Mode = if ($args.Count -gt 0) { $args[0] } else { "" }

try {
  Add-Type -AssemblyName System.Drawing
} catch {
  Write-Output "FATAL`t.NET printing support (System.Drawing) could not be loaded: $($_.Exception.Message)"
  exit 2
}

function Get-PaperSourceNames([string]$PrinterName) {
  $settings = New-Object System.Drawing.Printing.PrinterSettings
  $settings.PrinterName = $PrinterName
  $names = @()
  if ($settings.IsValid) {
    foreach ($source in $settings.PaperSources) { $names += $source.SourceName }
  }
  return $names
}

if ($Mode -eq "--check") {
  try {
    [void][System.Drawing.Printing.PrinterSettings]::InstalledPrinters
    Write-Output "READY"
    exit 0
  } catch {
    Write-Output "FATAL`t$($_.Exception.Message)"
    exit 2
  }
}

if ($Mode -eq "--list") {
  $printers = @()
  foreach ($name in [System.Drawing.Printing.PrinterSettings]::InstalledPrinters) {
    $printers += [PSCustomObject]@{ name = $name; displayName = $name; paperSources = @(Get-PaperSourceNames $name) }
  }
  Write-Output (ConvertTo-Json @($printers) -Compress -Depth 4)
  exit 0
}

# Default mode: read one JSON print job from stdin - { printerName, paperSource?, widthHundredths,
# heightHundredths, landscape, pages: [{ id, fields: [{ text, xHundredths, yHundredths,
# widthHundredths, fontPt, italic, bold, align }] }] } - and print each page as its own job. One
# tagged result line per page (<id> OK / <id> ERROR <message>) is emitted, matching
# print-labels.vbs's convention, so a partial batch failure is never reported as a total one.
$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) {
  Write-Output "FATAL`tNo print job was supplied on stdin."
  exit 2
}

try {
  $job = $raw | ConvertFrom-Json
} catch {
  Write-Output "FATAL`tThe print job JSON could not be parsed: $($_.Exception.Message)"
  exit 2
}

$installed = @([System.Drawing.Printing.PrinterSettings]::InstalledPrinters)
if ($installed -notcontains $job.printerName) {
  Write-Output "FATAL`tThe configured printer '$($job.printerName)' is not installed."
  exit 3
}

function New-CremationFont([double]$FontPt, [bool]$Italic, [bool]$Bold) {
  $family = $null
  foreach ($candidate in @("Bookman Old Style", "Georgia")) {
    try { $family = New-Object System.Drawing.FontFamily($candidate); break } catch { continue }
  }
  if (-not $family) { $family = [System.Drawing.FontFamily]::GenericSerif }
  $style = [System.Drawing.FontStyle]::Regular
  if ($Italic) { $style = $style -bor [System.Drawing.FontStyle]::Italic }
  if ($Bold) { $style = $style -bor [System.Drawing.FontStyle]::Bold }
  return New-Object System.Drawing.Font($family, [float]$FontPt, $style)
}

foreach ($page in @($job.pages)) {
  $fields = @($page.fields)
  $doc = New-Object System.Drawing.Printing.PrintDocument
  $doc.PrinterSettings.PrinterName = $job.printerName
  $doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize("Custom", [int]$job.widthHundredths, [int]$job.heightHundredths)
  $doc.DefaultPageSettings.Landscape = [bool]$job.landscape
  # Even with Margins zeroed, .NET/GDI+ still anchors (0,0) in PrintPage's Graphics to the
  # printer's own hardware-enforced minimum margin, not the true physical paper edge - and that
  # hardware margin is not symmetric (confirmed by inspecting PrintableArea directly: a few mm on
  # one axis, over a centimeter on the other for this printer's envelope tray). Drawing at raw
  # field coordinates therefore lands shifted toward whichever edge has the larger hardware margin.
  # e.MarginBounds (read inside PrintPage below) reports the correct, hardware-aware origin for
  # any printer/paper/orientation, so fields are offset by it rather than drawn at (0,0) directly.
  $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)

  $sourceError = $false
  if ($job.paperSource) {
    $matchedSource = $doc.PrinterSettings.PaperSources | Where-Object { $_.SourceName -eq $job.paperSource } | Select-Object -First 1
    if (-not $matchedSource) {
      Write-Output "$($page.id)`tERROR`tThe configured paper source '$($job.paperSource)' was not found on '$($job.printerName)'."
      $sourceError = $true
    } else {
      $doc.DefaultPageSettings.PaperSource = $matchedSource
    }
  }
  if ($sourceError) { $doc.Dispose(); continue }

  $doc.add_PrintPage({
    param($sender, $e)
    $e.Graphics.PageUnit = [System.Drawing.GraphicsUnit]::Display
    $originX = $e.MarginBounds.X
    $originY = $e.MarginBounds.Y
    foreach ($field in $fields) {
      $font = New-CremationFont -FontPt $field.fontPt -Italic ([bool]$field.italic) -Bold ([bool]$field.bold)
      $format = New-Object System.Drawing.StringFormat
      $format.Alignment = if ($field.align -eq "center") { [System.Drawing.StringAlignment]::Center } else { [System.Drawing.StringAlignment]::Near }
      # Line height isn't in the payload (CSS never gave these spans an explicit height either -
      # they auto-fit their content), so it's derived here from the font size with headroom for
      # descenders rather than clipping the drawn text to a too-tight box.
      $heightHundredths = [Math]::Round($field.fontPt * (100.0 / 72.0) * 1.6)
      $rect = New-Object System.Drawing.RectangleF([float]($field.xHundredths + $originX), [float]($field.yHundredths + $originY), [float]$field.widthHundredths, [float]$heightHundredths)
      $e.Graphics.DrawString($field.text, $font, [System.Drawing.Brushes]::Black, $rect, $format)
      $font.Dispose()
      $format.Dispose()
    }
    $e.HasMorePages = $false
  })

  try {
    $doc.Print()
    Write-Output "$($page.id)`tOK"
  } catch {
    Write-Output "$($page.id)`tERROR`t$($_.Exception.Message)"
  } finally {
    $doc.Dispose()
  }
}
