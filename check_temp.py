import paramiko
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("106.52.237.169", port=8022, username="cycroot", password="chenyuchao", timeout=30)

commands = [
    # 检查服务器日志
    "tail -50 /home/cycroot/.pm2/logs/agent-chat-out.log",
    # 检查错误日志
    "tail -20 /home/cycroot/.pm2/logs/agent-chat-error.log",
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
