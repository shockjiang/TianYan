ssh -p 20245 -N -L 10086:127.0.0.1:10086 root@115.191.67.128

Then open http://localhost:10086 in your local browser. Leave that terminal running; -N means "no remote command, just the tunnel."

Same command works verbatim in Windows PowerShell / cmd (OpenSSH client is built in) and macOS/Linux.

Make it convenient

Add to your local ~/.ssh/config:

Host tianyan
    HostName 115.191.67.128
    Port 20245
    User root
    LocalForward 10086 127.0.0.1:10086
    ServerAliveInterval 30
    ServerAliveCountMax 3
