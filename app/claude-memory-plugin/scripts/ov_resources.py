#!/usr/bin/env python3
"""OpenViking resource management for Claude Code agents and skills.

Usage:
  ov_resources.py add <path> [--reason REASON]     # Ingest file/dir into viking://resources/
  ov_resources.py search <query> [--limit N]        # Semantic search across all resources
  ov_resources.py list                              # List top-level resources
  ov_resources.py read <viking_uri>                 # Read content at a viking:// URI
  ov_resources.py tree <viking_uri> [--depth N]     # Show resource tree

Requires:
  - OPENVIKING_CONFIG_FILE env var or ov.conf in project root
  - openviking Python package in ~/.openviking-venv/
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def _find_config():
    """Find ov.conf - check env var, then walk up from cwd."""
    env = os.environ.get("OPENVIKING_CONFIG_FILE")
    if env and Path(env).exists():
        return env
    cwd = Path.cwd()
    for parent in [cwd, *cwd.parents]:
        candidate = parent / "ov.conf"
        if candidate.exists():
            return str(candidate)
    return None


def _find_data_path(conf_path: str) -> str:
    """Resolve data path from ov.conf storage.workspace."""
    conf_dir = Path(conf_path).parent
    with open(conf_path) as f:
        conf = json.load(f)
    workspace = conf.get("storage", {}).get("workspace", "./data")
    return str((conf_dir / workspace).resolve())


def _get_client():
    conf = _find_config()
    if not conf:
        print("Error: ov.conf not found", file=sys.stderr)
        sys.exit(1)
    os.environ["OPENVIKING_CONFIG_FILE"] = conf
    from openviking import SyncOpenViking
    data_path = _find_data_path(conf)
    client = SyncOpenViking(path=data_path)
    client.initialize()
    return client


def cmd_add(args):
    client = _get_client()
    path = str(Path(args.path).resolve())
    result = client.add_resource(
        path=path,
        reason=args.reason or "",
        wait=True,
        timeout=args.timeout,
        summarize=True,
        build_index=True,
    )
    root_uri = result.get("root_uri", "")
    embed = result.get("queue_status", {}).get("Embedding", {})
    print(json.dumps({
        "ok": True,
        "root_uri": root_uri,
        "embeddings": embed.get("processed", 0),
        "errors": embed.get("error_count", 0),
    }))


def cmd_search(args):
    client = _get_client()
    results = client.find(
        query=args.query,
        target_uri=args.target_uri or "",
        limit=args.limit,
    )
    output = []
    for r in results:
        uri = r.uri if hasattr(r, "uri") else r.get("uri", "")
        score = float(r.score if hasattr(r, "score") else r.get("score", 0))
        abstract = r.abstract if hasattr(r, "abstract") else r.get("abstract", "")
        output.append({"uri": uri, "score": round(score, 4), "abstract": str(abstract)[:200]})
    print(json.dumps(output, indent=2))


def cmd_list(args):
    client = _get_client()
    items = client.ls("viking://resources/")
    for item in items:
        if item.get("isDir"):
            print(f"  {item['name']}/ -> {item['uri']}")


def cmd_read(args):
    client = _get_client()
    content = client.read(args.uri)
    print(content)


def cmd_tree(args):
    client = _get_client()
    tree = client.tree(args.uri, depth=args.depth)
    for item in tree:
        depth = item.get("rel_path", "").count("/")
        indent = "  " * depth
        name = item.get("name", "")
        if item.get("isDir"):
            print(f"{indent}{name}/")
        elif not name.startswith("."):
            print(f"{indent}{name}")


def main():
    parser = argparse.ArgumentParser(description="OpenViking resource management")
    sub = parser.add_subparsers(dest="command", required=True)

    p_add = sub.add_parser("add", help="Ingest file/dir into resources")
    p_add.add_argument("path", help="Local path to ingest")
    p_add.add_argument("--reason", default="", help="Why this resource is being added")
    p_add.add_argument("--timeout", type=int, default=300, help="Timeout in seconds")

    p_search = sub.add_parser("search", help="Semantic search across resources")
    p_search.add_argument("query", help="Search query")
    p_search.add_argument("--limit", type=int, default=5, help="Max results")
    p_search.add_argument("--target-uri", default="", help="Narrow search to a URI")

    p_list = sub.add_parser("list", help="List top-level resources")

    p_read = sub.add_parser("read", help="Read content at a viking:// URI")
    p_read.add_argument("uri", help="viking:// URI to read")

    p_tree = sub.add_parser("tree", help="Show resource tree")
    p_tree.add_argument("uri", help="viking:// URI root")
    p_tree.add_argument("--depth", type=int, default=2, help="Tree depth")

    args = parser.parse_args()
    {
        "add": cmd_add,
        "search": cmd_search,
        "list": cmd_list,
        "read": cmd_read,
        "tree": cmd_tree,
    }[args.command](args)


if __name__ == "__main__":
    main()
