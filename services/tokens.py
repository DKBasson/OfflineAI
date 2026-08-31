import atexit
import json
import logging

from services.config import _TOKEN_STATS_FILE, _MAX_TOKEN_STATS_ENTRIES

log = logging.getLogger("offlineai")


def _load_token_stats() -> dict:
    try:
        if _TOKEN_STATS_FILE.exists():
            raw = json.loads(_TOKEN_STATS_FILE.read_text(encoding="utf-8"))
            return {k: v for k, v in raw.items()
                    if isinstance(v, list) and len(v) == 2
                    and all(isinstance(x, (int, float)) for x in v)}
    except Exception:
        pass
    return {}


def _save_token_stats() -> None:
    global _token_stats
    if len(_token_stats) > _MAX_TOKEN_STATS_ENTRIES:
        _token_stats = dict(
            sorted(
                _token_stats.items(),
                key=lambda x: x[1][0] + x[1][1],
                reverse=True,
            )[:_MAX_TOKEN_STATS_ENTRIES]
        )
    try:
        _TOKEN_STATS_FILE.write_text(json.dumps(_token_stats), encoding="utf-8")
    except Exception:
        pass


_token_stats: dict[str, list[int]] = _load_token_stats()


def _token_table_lines(active: str | None, prompt_req: int, completion_req: int) -> list[str]:
    stats    = _token_stats
    name_col = max(15, max((len(k) for k in stats), default=0) + 4)
    total_p  = sum(v[0] for v in stats.values())
    total_c  = sum(v[1] for v in stats.values())
    grand    = total_p + total_c
    W = name_col + 39
    C = "─"
    if active is not None:
        head = f" Token Usage  ·  +{prompt_req + completion_req:,} this request "
    else:
        head = " Session Token Summary  ·  Server Shutdown "
    head = head.center(W)
    lines = [
        f"┌{C * W}┐",
        f"│{head}│",
        f"├{C * name_col}┬{C * 12}┬{C * 12}┬{C * 12}┤",
        f"│ {'Client':<{name_col - 2}} │ {'Prompt':>10} │ {'Completion':>10} │ {'Total':>10} │",
        f"├{C * name_col}┼{C * 12}┼{C * 12}┼{C * 12}┤",
    ]
    for name, (p, c) in sorted(stats.items(), key=lambda x: -(x[1][0] + x[1][1])):
        marker = " ◀" if name == active else ""
        lines.append(
            f"│ {(name + marker):<{name_col - 2}} │ {p:>10,} │ {c:>10,} │ {p + c:>10,} │"
        )
    lines += [
        f"├{C * name_col}┼{C * 12}┼{C * 12}┼{C * 12}┤",
        f"│ {'TOTAL':<{name_col - 2}} │ {total_p:>10,} │ {total_c:>10,} │ {grand:>10,} │",
        f"└{C * name_col}┴{C * 12}┴{C * 12}┴{C * 12}┘",
    ]
    return lines


def _print_token_table(display_name: str, prompt_req: int, completion_req: int) -> None:
    log.info("\n" + "\n".join(_token_table_lines(display_name, prompt_req, completion_req)))


def _print_shutdown_summary() -> None:
    if not _token_stats:
        return
    log.info("\n" + "\n".join(_token_table_lines(None, 0, 0)))


atexit.register(_print_shutdown_summary)


def _tally_done_line(line: bytes, display_name: str) -> None:
    line = line.strip()
    if not line:
        return
    try:
        data = json.loads(line)
        if data.get("done"):
            prompt_req     = data.get("prompt_eval_count", 0)
            completion_req = data.get("eval_count", 0)
            entry = _token_stats.setdefault(display_name, [0, 0])
            entry[0] += prompt_req
            entry[1] += completion_req
            _save_token_stats()
            _print_token_table(display_name, prompt_req, completion_req)
    except (json.JSONDecodeError, AttributeError):
        pass
