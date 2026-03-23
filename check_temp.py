import paramiko
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("106.52.237.169", port=8022, username="cycroot", password="chenyuchao", timeout=30)

# 检查 agent-manager.js 中是否还有重复的 message handler
commands = [
    "grep -n 'ws.on.*message' /home/cycroot/agent-chat/src/server/agent-manager.js",
    "grep -n 'ws.on.*message' /home/cycroot/agent-chat/src/server/websocket.js",
    "echo '--- agent-manager.js setupAgentMessageHandler function ---'",
    "grep -A20 'setupAgentMessageHandler' /home/cycroot/agent-chat/src/server/agent-manager.js | head -25"
]

for cmd in commands:
    print(f"\n>>> {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    if out:
        print(out)
    if err:
        print(f"[ERR] {err}")

ssh.close()
