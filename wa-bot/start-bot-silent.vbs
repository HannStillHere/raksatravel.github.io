Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\Raihan\OneDrive\Desktop\raksatravel\wa-bot"
WshShell.Run "cmd /c start-bot.bat", 0, False
