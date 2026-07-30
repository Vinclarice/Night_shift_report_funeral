Option Explicit
On Error Resume Next

Const BPO_AUTO_CUT = 1

Dim document, mode, templatePath, printerName
mode = ""
If WScript.Arguments.Count > 0 Then mode = WScript.Arguments(0)

Set document = CreateObject("bpac.Document")
If Err.Number <> 0 Or document Is Nothing Then
  WScript.Echo "FATAL" & vbTab & "Brother b-PAC is not installed or could not be started."
  WScript.Quit 2
End If

If mode = "--check" Then
  WScript.Echo "READY"
  WScript.Quit 0
End If

If WScript.Arguments.Count < 2 Then
  WScript.Echo "FATAL" & vbTab & "The label template or printer name was not supplied."
  WScript.Quit 2
End If

templatePath = WScript.Arguments(0)
printerName = WScript.Arguments(1)

Dim opened
opened = document.Open(templatePath)
If opened = False Then
  WScript.Echo "FATAL" & vbTab & "The P-touch label template could not be opened. Brother error " & document.ErrorCode
  WScript.Quit 3
End If

If document.SetPrinter(printerName, False) = False Then
  WScript.Echo "FATAL" & vbTab & "The P-touch printer could not be selected. Brother error " & document.ErrorCode
  document.Close
  WScript.Quit 3
End If

If document.StartPrint("Cremation labels", BPO_AUTO_CUT) = False Then
  WScript.Echo "FATAL" & vbTab & "The Brother print job could not be started. Brother error " & document.ErrorCode
  document.Close
  WScript.Quit 4
End If

Dim line, separator, rowId, displayName, labelObject
Do Until WScript.StdIn.AtEndOfStream
  line = WScript.StdIn.ReadLine
  separator = InStr(line, vbTab)
  If separator > 1 Then
    rowId = Left(line, separator - 1)
    displayName = Mid(line, separator + 1)
    Err.Clear
    Set labelObject = document.GetObject("DeceasedName")
    If Err.Number <> 0 Or labelObject Is Nothing Then
      WScript.Echo "FATAL" & vbTab & "The DeceasedName field is missing from the P-touch template."
      Exit Do
    End If
    labelObject.Text = displayName
    If document.PrintOut(1, BPO_AUTO_CUT) = True Then
      WScript.Echo rowId & vbTab & "OK"
    Else
      WScript.Echo rowId & vbTab & "ERROR" & vbTab & "Brother error " & document.ErrorCode
      Exit Do
    End If
  End If
Loop

document.EndPrint
document.Close
Set document = Nothing
