# common/run_all.py
import subprocess
import sys
import os


def run_script(folder, script_name):
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    target_dir = os.path.join(root_dir, folder) if folder else root_dir
    try:
        subprocess.run([sys.executable, script_name], cwd=target_dir, check=True)
        return True
    except Exception:
        return False


if __name__ == "__main__":
    success = True
    # 1. 跑 market 目录下的沪深市值和均价
    if not run_script("market", "avg_price.py"): success = False
    # 2. 跑 etf 目录下的 ETF 流水线
    if not run_script("etf", "etf_share.py"): success = False
    # 3. 跑 top_base 目录下的破净与指数月线
    if not run_script("top_base", "top_base.py"): success = False

    if not success:
        sys.exit(1)  # 只要有一个错，最后标记为失败