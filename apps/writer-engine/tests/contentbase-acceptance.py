#!/usr/bin/env python3
# ContentBase HTTP acceptance entry.
# 增量资料入口：加 --materials-only 只运行第一阶段资料收集 agents，保存 materials md/json，不进入大纲、正文和写后审查。
"""ContentBase 生产验收脚本。

这个文件是 ContentBase 文章生成链路的端到端验收入口：必要时发布并部署
ContentBase/DataBase，然后通过生产 HTTP API 触发文章生成，最后把生成正文、
召回诊断、agent 诊断和外部 AI 复盘保存到本地报告。

注释重点解释“为什么要检查这个边界”，避免后续维护时把生产验收误改成
本地 preview、降级路线或只看 HTTP 200 的浅层健康检查。
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import secrets
import shutil
import shlex
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any


DEFAULT_TOPIC = "战争、海权与国家机器，理解近代东亚的地缘政治方法论"
DEFAULT_PREFACE_INPUT = """请写《百年东亚》的全书前言四，标题为《战争、海权与国家机器，理解近代东亚的地缘政治方法论》。

核心要求：这篇不是写“日本主体性丧失”，而是写本书的方法论：把克劳塞维茨《战争论》、马汉《海权论》、马基雅维利《君主论》作为理解近代东亚的三套思想工具。

必须展开三条主线：
一、用《海权论》看近代东亚：海不是背景，而是贸易线、航道、港口、煤站、海军、海关、金融与殖民通道。英国、法国、美国、日本怎样通过海权重写东亚。鸦片战争、甲午战争、台湾、朝鲜、越南、琉球、菲律宾、马六甲、黄海、对马海峡都可作为地理锚点。
二、用《战争论》看近代东亚：战争不是道德剧，不是单纯战役胜负，而是政治目的以暴力穿过边界，并在条约、赔款、租界、铁路权、驻军权、保护国、殖民地里固定下来。中法战争、甲午战争、日俄战争、全面侵华、太平洋战争都要回到政治目的。
三、用《君主论》看近代东亚：近代国家首先被考验的是国家机器，能不能征税、征兵、修铁路、建海军、统一财政、压住地方、把命令从中央送到基层。明治日本、大清、朝鲜、越南、蒙古的命运差异，要从国家机器强弱与方向看。

写作位置：承接前三篇前言关于中华秩序、世界史立场、中国崩溃周期的论证；为后面中国、日本、朝鲜、越南、蒙古各册提供共同方法。结尾要明确：本书不是崇拜西方理论，而是把这些理论当刀，用来解剖东亚为什么被打开、为什么战争会沉入制度、为什么国家机器决定承受能力。

风格要求：中文长文，适合直接放入 Obsidian 文稿；不要 Markdown 小标题，不要条目，不要“首先/其次/最后”的论文腔，不要写成提纲；尽量使用具体空间、制度、战后文本和历史场景开篇；保持冷静、密实、有叙事推进。目标正文约 8000 字。
"""


@dataclass
class Args:
    """命令行参数快照。

    parse_args 只负责把 CLI/env 归一到这个不可嵌套的配置对象；后面的执行阶段
    都读全局 ARGS，避免在长验收链路里反复传递几十个阈值和远程路径。
    """

    base_url: str
    api_key: str
    topic: str
    target_word_count: int
    min_body_length: int | None
    timeout_sec: int
    poll_interval_sec: int
    save_dir: Path
    log_dir: Path | None
    expected_source_commit: str
    expected_model: str
    expected_sources: int
    expected_chunks: int
    expected_citations: int
    expected_ragflow_status: str
    min_ragflow_recalled_units: int
    min_ragflow_packed_units: int
    required_ragflow_channels: str
    expected_storm_status: str
    min_storm_perspectives: int
    min_storm_questions: int
    min_storm_citations: int
    deploy: bool
    commit_message: str
    database_root: Path
    database_url: str
    ssh_host: str
    remote_contentbase_source_root: str
    remote_contentbase_compose_root: str
    contentbase_service_name: str
    contentbase_git_remote: str
    contentbase_push_remote: str
    node_base_image: str
    deploy_timeout_sec: int
    deploy_poll_interval_sec: int
    allow_no_changes: bool
    require_deploy_marker_commit: bool
    skip_dependency_deploy: bool
    skip_local_checks: bool
    attach_example_and_tag: bool
    acceptance_tag: str
    http_only: bool
    sync: bool
    materials_only: bool
    ai_review_timeout_sec: int
    local_checks_only: bool
    skip_preflight: bool
    docker_images_only: bool


ARGS: Args
REPO_ROOT: Path
SCRIPT_ROOT: Path
LOG_FILE: Path | None = None
RUN_ID: str = ""
SOFT_WARNINGS: list[str] = []


def parse_args() -> Args:
    """读取 .env、CLI 和默认值，形成本次验收的唯一配置源。"""

    default_repo_root = Path(__file__).resolve().parent.parent
    default_bundle_runtime = default_repo_root / "ops" / "bundle" / "runtime"
    import_local_env(default_repo_root / ".env")
    parser = argparse.ArgumentParser(description="ContentBase production HTTP acceptance.")
    parser.add_argument("--base-url", default=os.environ.get("CONTENTBASE_TEST_BASE_URL", "https://contentbase.example.invalid"))
    parser.add_argument("--api-key", default=os.environ.get("CONTENTBASE_API_KEY", ""))
    parser.add_argument("--topic", default="")
    parser.add_argument("--target-word-count", type=int, default=8000)
    parser.add_argument("--min-body-length", type=int, default=None)
    parser.add_argument("--timeout-sec", type=int, default=1800)
    parser.add_argument("--poll-interval-sec", type=int, default=5)
    parser.add_argument("--save-dir", type=Path, default=Path(os.environ.get("CONTENTBASE_ACCEPTANCE_OUTPUT_DIR", str(default_bundle_runtime / "outputs"))))
    parser.add_argument("--log-dir", type=Path, default=Path(os.environ.get("CONTENTBASE_LOG_DIR", str(default_bundle_runtime / "logs"))))
    parser.add_argument("--expected-source-commit", default=os.environ.get("CONTENTBASE_EXPECTED_SOURCE_COMMIT", ""))
    parser.add_argument("--expected-model", default=os.environ.get("CONTENTBASE_EXPECTED_MODEL", "deepseek-chat"))
    parser.add_argument("--expected-sources", type=int, default=20)
    parser.add_argument("--expected-chunks", type=int, default=50)
    parser.add_argument("--expected-citations", type=int, default=50)
    parser.add_argument("--expected-ragflow-status", default="ok")
    parser.add_argument("--min-ragflow-recalled-units", type=int, default=80)
    parser.add_argument("--min-ragflow-packed-units", type=int, default=40)
    parser.add_argument("--required-ragflow-channels", default="reality,literary,structure,author,lexicon")
    parser.add_argument("--expected-storm-status", default="ok")
    parser.add_argument("--min-storm-perspectives", type=int, default=3)
    parser.add_argument("--min-storm-questions", type=int, default=6)
    parser.add_argument("--min-storm-citations", type=int, default=1)
    parser.add_argument("--deploy", action="store_true")
    parser.add_argument("--commit-message", default="chore(contentbase): acceptance deploy")
    parser.add_argument("--database-root", type=Path, default=Path(os.environ.get("CONTENTBASE_DATABASE_ROOT", r"E:\My Project\Content-Platform\repos\DataBase")))
    parser.add_argument("--database-url", default=os.environ.get("CONTENTBASE_DATABASE_GATEWAY_URL", "https://database.example.invalid"))
    parser.add_argument("--ssh-host", default=os.environ.get("CONTENTBASE_DEPLOY_SSH_HOST", "rainyun"))
    parser.add_argument("--remote-contentbase-root", default=os.environ.get("CONTENTBASE_REMOTE_ROOT", "/srv/contentbase-source"))
    parser.add_argument("--contentbase-service-name", default=os.environ.get("CONTENTBASE_SERVICE_NAME", "contentbase"))
    parser.add_argument("--contentbase-git-remote", default=os.environ.get("CONTENTBASE_GIT_REMOTE", "git@github.com:emptyinkpot/ContentBase.git"))
    parser.add_argument("--contentbase-push-remote", default=os.environ.get("CONTENTBASE_PUSH_REMOTE", "https://github.com/emptyinkpot/ContentBase.git"))
    parser.add_argument("--remote-contentbase-source-root", default=os.environ.get("CONTENTBASE_REMOTE_SOURCE_ROOT", "/srv/contentbase-source"))
    parser.add_argument("--remote-contentbase-compose-root", default=os.environ.get("CONTENTBASE_REMOTE_COMPOSE_ROOT", "/srv/contentbase-source"))
    parser.add_argument("--node-base-image", default=os.environ.get("CONTENTBASE_NODE_BASE_IMAGE", "node:20-slim"))
    parser.add_argument("--deploy-timeout-sec", type=int, default=int(os.environ.get("CONTENTBASE_DEPLOY_TIMEOUT_SEC", "900")))
    parser.add_argument("--deploy-poll-interval-sec", type=int, default=int(os.environ.get("CONTENTBASE_DEPLOY_POLL_INTERVAL_SEC", "30")))
    parser.add_argument("--allow-no-changes", action="store_true")
    parser.add_argument("--require-deploy-marker-commit", action="store_true", help="opt-in: create an empty marker commit on a clean tree (default: do not pollute history)")
    parser.add_argument("--skip-dependency-deploy", action="store_true")
    parser.add_argument("--skip-local-checks", action="store_true")
    parser.add_argument("--attach-example-and-tag", action="store_true")
    parser.add_argument("--acceptance-tag", default="")
    parser.add_argument("--http-only", action="store_true")
    parser.add_argument("--sync", action="store_true")
    parser.add_argument("--materials-only", action="store_true")
    parser.add_argument("--ai-review-timeout-sec", type=int, default=300)
    parser.add_argument("--local-checks-only", action="store_true")
    parser.add_argument("--skip-preflight", action="store_true")
    parser.add_argument("--docker-images-only", action="store_true", help="only ensure CONTENTBASE_REQUIRED_LOCAL_DOCKER_IMAGES via Docker SDK, then exit")
    ns = parser.parse_args()
    data = vars(ns)
    data.pop('remote_contentbase_root', None)
    return Args(**data)


class Tee:
    """把 stdout/stderr 同时写到控制台和验收日志。"""

    def __init__(self, stream: Any, log_path: Path | None) -> None:
        self.stream = stream
        self.log_path = log_path

    def write(self, text: str) -> int:
        self.stream.write(text)
        self.stream.flush()
        if self.log_path:
            with self.log_path.open("a", encoding="utf-8") as fh:
                fh.write(text)
        return len(text)

    def flush(self) -> None:
        self.stream.flush()


def initialize_acceptance_run(args: Args) -> None:
    """初始化全局运行状态、仓库根目录、run-id 和日志重定向。"""

    global ARGS, REPO_ROOT, SCRIPT_ROOT, LOG_FILE, RUN_ID, SOFT_WARNINGS
    ARGS = args
    RUN_ID = f"{datetime.now():%Y%m%d-%H%M%S}-{secrets.token_hex(2)}"
    SOFT_WARNINGS = []
    if ARGS.min_body_length is None:
        ARGS.min_body_length = resolve_length_window(ARGS.target_word_count)[0]
    SCRIPT_ROOT = Path(__file__).resolve().parent
    REPO_ROOT = SCRIPT_ROOT.parent
    os.chdir(REPO_ROOT)
    import_local_env(REPO_ROOT / ".env")
    # Windows consoles default to GBK; the verdict line uses '⚠' for soft warnings.
    # Reconfigure stdio to UTF-8 (with replace as a safety net) before Tee wraps them.
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass
    if ARGS.log_dir:
        ARGS.log_dir.mkdir(parents=True, exist_ok=True)
        LOG_FILE = ARGS.log_dir / f"contentbase-acceptance-py-{RUN_ID}.log"
        sys.stdout = Tee(sys.stdout, LOG_FILE)  # type: ignore[assignment]
        sys.stderr = Tee(sys.stderr, LOG_FILE)  # type: ignore[assignment]
    print(f"[tests] run-id={RUN_ID}", flush=True)


def import_local_env(path: Path) -> None:
    """导入本地 .env，但不覆盖调用方已经显式设置的环境变量。"""

    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if not key or not value or value.startswith("replace-with-"):
            continue
        os.environ.setdefault(key, value)


def write_step(message: str) -> None:
    """输出带统一前缀的验收进度行，便于日志里按阶段检索。"""

    print(f"[tests] {message}", flush=True)


def warn(message: str) -> None:
    """输出非阻断告警；真正阻断仍通过 RuntimeError fail fast。"""

    print(f"WARNING: {message}", file=sys.stderr, flush=True)


def run_command(args: list[str], cwd: Path | None = None, input_text: str | None = None, timeout: int | None = None) -> str:
    """运行本地命令并把非零退出码提升为异常。"""

    executable = shutil.which(args[0])
    if executable:
        args = [executable, *args[1:]]
    input_bytes = input_text.encode("utf-8") if input_text is not None else None
    completed = subprocess.run(
        args,
        cwd=str(cwd or REPO_ROOT),
        input=input_bytes,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=timeout,
    )
    output = completed.stdout.decode("utf-8", errors="replace").strip()
    if completed.returncode != 0:
        raise RuntimeError(f"{' '.join(args)} failed with exit code {completed.returncode}: {output}")
    return output


def resolve_base_url() -> str:
    """规范化生产服务地址，去掉尾部斜杠。"""

    if not ARGS.base_url:
        raise RuntimeError("base_url is required. Pass --base-url or set CONTENTBASE_TEST_BASE_URL.")
    return ARGS.base_url.strip().rstrip("/")


def resolve_topic() -> str:
    """使用显式主题；未传主题时走默认长文验收题。"""

    return ARGS.topic or DEFAULT_TOPIC


def invoke_git(git_args: list[str], repo_root: Path | None = None) -> str:
    """在指定仓库运行 git，并复用统一命令错误处理。"""

    repo = repo_root or REPO_ROOT
    return run_command(["git", "-C", str(repo), *git_args], cwd=repo)


def get_git_head(repo_root: Path | None = None) -> str:
    """返回仓库当前 HEAD commit，用于部署和生产回读对齐。"""

    return invoke_git(["rev-parse", "HEAD"], repo_root).strip()


def get_git_branch(repo_root: Path | None = None) -> str:
    """返回当前分支；部署路径拒绝 detached HEAD。"""

    return invoke_git(["branch", "--show-current"], repo_root).strip()


def get_git_status_short(repo_root: Path | None = None, untracked: bool = True) -> str:
    """读取短格式工作区状态，按需要忽略未跟踪文件。"""

    args = ["status", "--short"]
    if not untracked:
        args.append("--untracked-files=no")
    return invoke_git(args, repo_root).strip()


def resolve_expected_source_commit() -> str:
    """确定生产诊断必须回报的 commit；未指定时默认本地 HEAD。"""

    if ARGS.expected_source_commit:
        return ARGS.expected_source_commit.strip()
    try:
        return get_git_head(REPO_ROOT)
    except Exception:
        return ""


def read_text(path: Path) -> str:
    """读取 UTF-8/UTF-8-BOM 文本，并把缺文件视为验收失败。"""

    if not path.exists():
        raise RuntimeError(f"missing file: {path}")
    return path.read_text(encoding="utf-8-sig")


def require_contains(text: str, needle: str, message: str) -> None:
    """源码契约断言：必须包含某个 owner/能力/边界标记。"""

    if needle not in text:
        raise RuntimeError(message)


def require_not_regex(text: str, pattern: str, message: str) -> None:
    """源码契约断言：不得出现已废弃路线或越权能力。"""

    if re.search(pattern, text, flags=re.S):
        raise RuntimeError(message)


def invoke_local_checks() -> None:
    """运行最小本地检查：TypeScript typecheck 加本文内置源码契约。"""

    if ARGS.skip_local_checks:
        write_step("skipping local checks by request")
        return
    write_step("running local typecheck")
    run_command(["npx", "tsc", "-p", "tsconfig.json", "--noEmit"], cwd=REPO_ROOT)
    assert_lexicon_ragflow_contract()
    assert_article_fullchain_source_contract()
    assert_agent_config_source_contract()
    assert_tool_registry_source_contract()
    assert_codex_context_brief_path_contract()
    assert_article_runtime_docs_contract()


def assert_lexicon_ragflow_contract() -> None:
    """确保 Writer 词汇材料走 RAGFlow 向量词表，不退回 MySQL 关键词搜索。"""

    write_step("checking lexicon RAGFlow contract")
    source_path = REPO_ROOT / "src/article/planning/context-builder.ts"
    source = read_text(source_path)
    require_contains(source, "/vocabulary/vector-search", "lexicon channel must call the RAGFlow-backed vector vocabulary endpoint")
    require_not_regex(source, r"getJson\('/vocabulary/search'", "ContentBase must not use MySQL keyword vocabulary search for Writer lexicon")
    require_not_regex(source, r"lexicon\.preferred", "style-contract preferred words must not be injected directly into Writer lexicon")
    require_not_regex(source, r"lexicon\.banned", "style-contract banned words must not be injected directly into Writer lexicon")
    require_not_regex(source, r"title:\s*'DataBase corpus contract lexicon'", "style-contract lexicon block must not be serialized into [LEXICON]")


def assert_article_runtime_docs_contract() -> None:
    """检查公开文档没有继续描述已退休的文章运行时路径。"""

    write_step("checking article runtime docs contract")
    for path in [REPO_ROOT / "README.md", REPO_ROOT / "docs/article-engine.md", REPO_ROOT / "docs/content-pipeline.mmd"]:
        text = read_text(path)
        if "src/domain/article" in text:
            raise RuntimeError(f"article runtime docs must not reference retired src/domain/article path: {path}")
        if "calls one Writer" in text:
            raise RuntimeError(f"article runtime docs must not claim the current fullchain only calls one Writer: {path}")
        if "revision/rewrite loop" in text:
            raise RuntimeError(f"article runtime docs must distinguish forbidden unbounded loops from canonical review/revision agents: {path}")
        if "multi-writer 编排" in text:
            raise RuntimeError(f"article runtime docs must not describe canonical agents as forbidden multi-writer orchestration: {path}")


def assert_article_fullchain_source_contract() -> None:
    """检查文章生成源码仍保留完整 runtime、context、agent flow 分层。"""

    write_step("checking article fullchain source contract")
    runtime_path = REPO_ROOT / "src/article/runtime/article-runtime.ts"
    flow_path = REPO_ROOT / "src/article/runtime/article-flow.ts"
    index_path = REPO_ROOT / "src/article/index.ts"
    context_path = REPO_ROOT / "src/article/planning/context-builder.ts"
    runtime = read_text(runtime_path)
    flow = read_text(flow_path)
    index = read_text(index_path)
    context = read_text(context_path)
    for needle in [
        "normalizeNaturalLanguageArticleRequest",
        "runtime.buildArticleContextEngine",
        "runArticleAgentFlow",
        "runtime.applyPostProcessing",
        "agentPipeline",
    ]:
        require_contains(runtime, needle, f"article generation runtime shell is missing required marker: {needle}")
    for needle in [
        "runFactAgent",
        "runWebRealityAgent",
        "runDivergenceAgent",
        "runContextSynthesizer",
        "runOutlineAgent",
        "runAuthorAgent",
        "runEnrichmentAgent",
        "runFormatReviewer",
        "runFactReviewer",
        "runAiResidueReviewer",
        "runRevisionAgent",
    ]:
        require_contains(flow, needle, f"article agent flow owner is missing required stage marker: {needle}")
    require_contains(index, "createArticleRuntime", "src/article/index.ts is missing required article export: createArticleRuntime")
    for needle in [
        "buildArticleContextEngine",
        "callSingleWriter",
        "applyPostProcessing",
        "runArticleAgentFlow",
        "runFactAgent",
        "runAuthorAgent",
        "runRevisionAgent",
    ]:
        if needle in index:
            raise RuntimeError(f"src/article/index.ts must not expose article internals: {needle}")
    require_contains(context, "export async function buildArticleContextEngine", "article context builder must export buildArticleContextEngine")


def assert_agent_config_source_contract() -> None:
    """检查 agent 注册表的模型、阶段、工具和 revision 边界没有漂移。"""

    write_step("checking article agent default profile contract")
    source = read_text(REPO_ROOT / "src/article/registry/agents.ts")
    tool_source = read_text(REPO_ROOT / "src/article/registry/tools.ts")
    adapter = read_text(REPO_ROOT / "src/article/agents/agent-config.ts")
    agent_names = [
        "fact_agent",
        "web_reality_agent",
        "divergence_agent",
        "meaning_agent",
        "outline_agent",
        "author_agent",
        "enrichment_agent",
        "format_reviewer",
        "fact_reviewer",
        "style_reviewer",
        "revision_agent",
        "final_editor_agent",
    ]
    for agent_name in agent_names:
        pattern = rf"{agent_name}:\s*\{{.*?profile:\s*'deepseek'"
        if not re.search(pattern, source, flags=re.S):
            raise RuntimeError(f"article agent default profile drifted from DeepSeek: {agent_name}")
    for field in ["canonicalName", "stage", "status", "kind", "bodyMutation", "factAuthority", "trigger", "reads", "writes", "tools", "inputContract", "outputContract", "systemPrompt"]:
        require_contains(source, field, f"article agent registry missing protocol field: {field}")
    require_not_regex(source, r"status:\s*'registered'", "article agent registry must not contain paper-only registered agents")
    for tool_name in ["llm_generation", "database_gateway", "ragflow_retrieval", "storm_research", "web_search", "literary_search", "semantic_search", "lexicon_lookup", "author_profile", "letta_memory", "context_pack", "format_sensor", "style_sensor", "source_boundary_checker"]:
        require_contains(tool_source, tool_name, f"article tool registry missing tool: {tool_name}")
    tool_stage_map = parse_article_tool_stage_map(tool_source)
    for agent_name in agent_names:
        agent_match = re.search(rf"{agent_name}:\s*\{{(?P<body>.*?)\n\s*\}},", source, flags=re.S)
        if not agent_match:
            raise RuntimeError(f"article agent registry missing agent block: {agent_name}")
        agent_body = agent_match.group("body")
        stage_match = re.search(r"stage:\s*'([^']+)'", agent_body)
        tools_match = re.search(r"tools:\s*\[(.*?)\]", agent_body, flags=re.S)
        if not stage_match or not tools_match:
            raise RuntimeError(f"article agent registry missing stage/tools block: {agent_name}")
        agent_stage = stage_match.group(1)
        agent_tools = re.findall(r"'([^']+)'", tools_match.group(1))
        if "llm_generation" not in agent_tools:
            raise RuntimeError(f"article agent must declare llm_generation capability: {agent_name}")
        for tool_name in agent_tools:
            if tool_name not in tool_stage_map:
                raise RuntimeError(f"article agent references unregistered tool: {agent_name}.{tool_name}")
            if agent_stage not in tool_stage_map[tool_name]:
                raise RuntimeError(f"article agent uses tool outside allowed stage: {agent_name}.{tool_name} stage={agent_stage}")
        if agent_name == "revision_agent":
            require_contains(agent_body, "局部修订", "revision_agent registry must declare local revision boundary")
            require_contains(agent_body, "不做全文重写", "revision_agent registry must forbid full rewrite")
            require_contains(agent_body, "不承担机械补字", "revision_agent registry must not own mechanical length repair")
            require_contains(agent_body, "writes: 'revision_patch'", "revision_agent registry must write patch artifact, not final body")
            require_contains(agent_body, "JSON patch", "revision_agent registry must declare JSON patch protocol")
            require_not_regex(agent_body, r"writes:\s*'final_body'", "revision_agent must not own final_body artifact directly")
            for forbidden in ["可以重写开头", "合并拆分相邻段落", "局部重排事实链", "可以整体压缩"]:
                require_not_regex(agent_body, re.escape(forbidden), f"revision_agent registry must not grant broad rewrite power: {forbidden}")
    require_contains(adapter, "ARTICLE_AGENT_REGISTRY", "agent-config.ts must consume the article agent registry")


def parse_article_tool_stage_map(tool_source: str) -> dict[str, set[str]]:
    """从工具注册源码里提取 tool -> allowedStages 映射。"""

    stage_map: dict[str, set[str]] = {}
    for match in re.finditer(r"(?P<name>[a-z_]+):\s*\{(?P<body>.*?)\n\s*\},", tool_source, flags=re.S):
        name = match.group("name")
        body = match.group("body")
        stages_match = re.search(r"allowedStages:\s*\[(.*?)\]", body, flags=re.S)
        if stages_match:
            stage_map[name] = set(re.findall(r"'([^']+)'", stages_match.group(1)))
    return stage_map


def assert_tool_registry_source_contract() -> None:
    """检查工具注册表声明了能力边界，避免工具被当作产物 owner。"""

    write_step("checking article tool capability registry contract")
    source = read_text(REPO_ROOT / "src/article/registry/tools.ts")
    for field in ["modulePath", "allowedStages", "factAuthority", "bodyAuthority", "contract"]:
        require_contains(source, field, f"article tool registry missing capability boundary field: {field}")
    for marker in ["reality_fact_source", "context_only", "preference_only", "sensor_only", "bodyAuthority: 'none'", "bodyAuthority: 'sensor_only'"]:
        require_contains(source, marker, f"article tool registry missing capability authority marker: {marker}")


def get_codex_context_brief_module_paths() -> list[str]:
    """列出外部 AI 复盘简报里允许提到的关键模块路径。"""

    return [
        "src/article/runtime/article-runtime.ts",
        "src/article/runtime/article-flow.ts",
        "src/article/registry",
        "src/article/tools",
        "src/article/planning",
        "src/article/context",
        "src/article/agents/planning",
        "src/article/agents/writing",
        "src/article/agents/review",
        "src/article/agents/prompts",
        "src/article/postprocess",
        "tests/contentbase-acceptance.py",
    ]


def assert_codex_context_brief_path_contract() -> None:
    """确保复盘简报里的模块路径是真实存在的当前路径。"""

    write_step("checking Codex context brief module paths")
    for relative_path in get_codex_context_brief_module_paths():
        if not (REPO_ROOT / relative_path).exists():
            raise RuntimeError(f"Codex context brief references missing path: {relative_path}")


def publish_repository(repo_root: Path, message: str, target: str, owner: str, patch: str, validate: str, no_empty_commit: bool) -> str:
    """提交并推送仓库，让后续远程部署能锁定唯一 commit。"""

    branch = get_git_branch(repo_root)
    if not branch:
        raise RuntimeError(f"cannot deploy {repo_root} from detached HEAD; checkout a branch first")
    status = get_git_status_short(repo_root)
    if status:
        write_step(f"staging local changes in {repo_root}")
        invoke_git(["add", "-A"], repo_root)
        invoke_git(["reset", "-q", "HEAD", "--", ".serena", ".opencode", ".runtime", ".tmp", ".tmp-verification", "workspace", "dist", "node_modules"], repo_root)
        invoke_git(["reset", "-q", "HEAD", "--", "*.log", "*.pid"], repo_root)
        body = [
            f"target: {target}",
            f"owner: {owner}",
            f"patch: {patch}; staged with local-runtime exclusions",
            "test-not-run: --skip-local-checks" if ARGS.skip_local_checks else f"validate: {validate}",
        ]
        write_step(f"committing local changes in {repo_root}")
        commit_args = ["commit", "-m", message]
        for line in body:
            commit_args.extend(["-m", line])
        invoke_git(commit_args, repo_root)
    elif not no_empty_commit:
        write_step(f"no local changes in {repo_root}; creating empty commit for manual deployment")
        invoke_git([
            "commit",
            "--allow-empty",
            "-m",
            f"chore(deploy): prepare {target} manual deploy",
            "-m",
            f"target: {target}",
            "-m",
            f"owner: {owner}",
            "-m",
            "patch: empty manual deployment marker",
            "-m",
            "test-not-run: --skip-local-checks" if ARGS.skip_local_checks else f"validate: {validate}",
        ], repo_root)
    else:
        write_step(f"no local changes in {repo_root}; deploying current HEAD without empty commit")
    head = get_git_head(repo_root)
    write_step(f"pushing {branch} at {head}")
    push_target = ARGS.contentbase_push_remote if repo_root == REPO_ROOT else "origin"
    invoke_git(["push", push_target, f"HEAD:{branch}"], repo_root)
    return head


def publish_current_repo() -> str:
    """发布当前 ContentBase 仓库，并返回要部署的 commit。"""

    return publish_repository(
        REPO_ROOT,
        ARGS.commit_message,
        "ContentBase production acceptance",
        "tests/contentbase-acceptance.py",
        "auto-stage current repository changes",
        "tests/contentbase-acceptance.py local typecheck and embedded lexicon RAGFlow contract",
        ARGS.allow_no_changes,
    )


def invoke_remote_script(script: str, label: str) -> str:
    """通过 SSH 在指定远端执行 bash 脚本，并把输出写入验收日志。"""

    write_step(f"running remote {label} on {ARGS.ssh_host}")
    output = run_command(["ssh", ARGS.ssh_host, "bash -s"], cwd=REPO_ROOT, input_text=script)
    if output:
        write_step(output)
    return output


def deploy_contentbase_remote(target_commit: str) -> None:
    """调用 canonical 生产部署脚本，把指定 commit 部署到远端 ContentBase。"""

    if not target_commit:
        raise RuntimeError("deploy_contentbase_remote requires target_commit")
    deploy_script = REPO_ROOT / "scripts" / "deploy-contentbase-production.py"
    if not deploy_script.exists():
        raise RuntimeError(f"canonical ContentBase deploy script not found: {deploy_script}")
    # canonical path: git-pull + on-server docker build (decoupled standalone script).
    # The commit is already on origin via publish_current_repo, so --skip-push.
    write_step(f"running canonical deploy script: {deploy_script}")
    run_command([
        sys.executable,
        str(deploy_script),
        "--remote-host", ARGS.ssh_host,
        "--source-root", ARGS.remote_contentbase_source_root,
        "--compose-root", ARGS.remote_contentbase_compose_root,
        "--service-name", ARGS.contentbase_service_name,
        "--git-remote", ARGS.contentbase_git_remote,
        "--node-base-image", ARGS.node_base_image,
        "--commit", target_commit,
        "--skip-push",
    ], cwd=REPO_ROOT, timeout=ARGS.deploy_timeout_sec)


def test_database_needs_deploy() -> bool:
    """判断 DataBase 是否有本地变更/未推送 commit，决定走部署还是 HTTP-only 验收。"""

    if not ARGS.database_root.exists():
        raise RuntimeError(f"DataBaseRoot not found: {ARGS.database_root}")
    status = get_git_status_short(ARGS.database_root, untracked=False)
    if status:
        write_step("DataBase has tracked local changes; running DataBase Python acceptance deploy path")
        return True
    branch = get_git_branch(ARGS.database_root)
    if not branch:
        raise RuntimeError("DataBase cannot be checked from detached HEAD; checkout a branch first")
    invoke_git(["fetch", "origin", branch], ARGS.database_root)
    ahead = int(invoke_git(["rev-list", "--count", f"origin/{branch}..HEAD"], ARGS.database_root).strip())
    if ahead > 0:
        write_step(f"DataBase local branch is ahead of origin/{branch} by {ahead} commit(s); running DataBase Python acceptance deploy path")
        return True
    write_step("DataBase has no tracked local changes or unpushed commits; running DataBase Python HTTP-only acceptance")
    return False


def invoke_database_acceptance(http_only: bool = False) -> None:
    """调用 DataBase 自己的生产验收入口，保证 ContentBase 依赖先可用。"""

    script_path = ARGS.database_root / "tests/database-acceptance.py"
    if not script_path.exists():
        raise RuntimeError(f"DataBase Python acceptance entry not found: {script_path}.")
    cmd = [
        sys.executable,
        str(script_path),
        "--base-url",
        ARGS.database_url,
        "--ssh-host",
        ARGS.ssh_host,
        "--deploy-timeout-sec",
        str(ARGS.deploy_timeout_sec),
        "--deploy-poll-interval-sec",
        str(ARGS.deploy_poll_interval_sec),
        "--log-dir",
        str(ARGS.log_dir or ""),
    ]
    if http_only:
        cmd.append("--http-only")
    else:
        cmd.extend(["--deploy", "--allow-no-changes"])
    if ARGS.skip_local_checks:
        cmd.append("--skip-local-checks")
    write_step(f"running DataBase acceptance entry: {script_path}")
    run_command(cmd, cwd=ARGS.database_root)


def deploy_dependencies() -> None:
    """部署或验收 ContentBase 的外部依赖。"""

    invoke_database_acceptance(http_only=not test_database_needs_deploy())


def ensure_dependencies_deployed() -> None:
    """按开关决定是否执行依赖部署/验收阶段。"""

    if ARGS.skip_dependency_deploy:
        write_step("skipping dependency deploy by request")
        return
    deploy_dependencies()


def new_http_headers() -> dict[str, str]:
    """构造生产 API 请求头，携带 run-id 和可选 API key。"""

    headers = {"Accept": "application/json"}
    if RUN_ID:
        headers["X-Request-Id"] = RUN_ID
    if ARGS.api_key:
        headers["Authorization"] = f"Bearer {ARGS.api_key}"
        headers["X-Api-Key"] = ARGS.api_key
    return headers


def invoke_json_request(method: str, url: str, body: Any = None, request_timeout_sec: int = 120) -> dict[str, Any]:
    """发送 JSON HTTP 请求，并把 HTTP/API 失败统一转为异常。"""

    data = None
    headers = new_http_headers()
    if body is not None:
        data = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=request_timeout_sec) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        error_text = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {method} {url} failed: HTTP {exc.code} {exc.reason} {error_text[:500]}") from exc
    except Exception as exc:
        raise RuntimeError(f"HTTP {method} {url} failed: {exc}") from exc
    parsed = json.loads(raw) if raw else {}
    if parsed.get("success") is False:
        message = parsed.get("error") or parsed.get("message") or "unknown API error"
        raise RuntimeError(f"HTTP {method} {url} returned success=false: {message}")
    return parsed


def wait_deployment_commit(resolved_base_url: str, target_commit: str) -> None:
    """轮询生产诊断，直到远端 sourceCommit 回读到目标 commit。"""

    if not target_commit:
        return
    deadline = datetime.now() + timedelta(seconds=ARGS.deploy_timeout_sec)
    while datetime.now() < deadline:
        try:
            diagnostics = invoke_json_request("GET", f"{resolved_base_url}/api/corpus/diagnostics", request_timeout_sec=120)
            source_commit = str(get_path(diagnostics, "data.env.injection.sourceCommit") or "")
            write_step(f"deployment sourceCommit={source_commit} target={target_commit}")
            if source_commit.startswith(target_commit):
                return
        except Exception as exc:
            write_step(f"deployment diagnostics not ready: {exc}")
        time.sleep(ARGS.deploy_poll_interval_sec)
    raise RuntimeError(f"production did not deploy target commit {target_commit} within {ARGS.deploy_timeout_sec}s")


def new_article_request_body(resolved_topic: str) -> dict[str, Any]:
    """构造文章生成请求体；默认题走完整前言输入，普通题走短证据查询。"""

    if not ARGS.topic and resolved_topic == DEFAULT_TOPIC:
        return {
            "input": DEFAULT_PREFACE_INPUT,
            "topic": resolved_topic,
            "target": resolved_topic,
            "structure": {"targetWordCount": ARGS.target_word_count},
            "evidenceQuery": {"query": "战争论 海权论 君主论 近代东亚 地缘政治", "includeRagflow": True, "requireCorpus": True, "limit": max(ARGS.expected_chunks, ARGS.expected_citations)},
            "settings": {},
        }
    return {
        "input": f"请写一篇不少于 {ARGS.target_word_count} 字的长文：{resolved_topic}",
        "topic": resolved_topic,
        "target": resolved_topic,
        "structure": {"targetWordCount": ARGS.target_word_count},
        "evidenceQuery": {"query": build_short_evidence_query(resolved_topic), "includeWeb": False, "persistWeb": False, "includeRagflow": True, "requireCorpus": True, "rounds": 2, "limit": max(ARGS.expected_chunks, ARGS.expected_citations), "evidenceTimeoutMs": 120000},
        "settings": {},
    }


def build_short_evidence_query(topic: str) -> str:
    """从长主题里抽出短查询词，避免把完整写作要求塞进检索 query。"""

    text = str(topic or '').strip()
    text = re.split(r'要求', text, maxsplit=1)[0]
    cleaned = re.sub(r'[：:，,。；;（）()“”"\'\n\r]+', ' ', text)
    parts = [part.strip() for part in cleaned.split() if len(part.strip()) >= 2]
    if not parts:
        return text[:80]
    return ' '.join(parts[:8])[:120]


def get_path(obj: Any, path: str, default: Any = None) -> Any:
    """按点号路径安全读取嵌套 dict/list。"""

    current = obj
    for part in path.split("."):
        if isinstance(current, dict) and part in current:
            current = current[part]
        elif isinstance(current, list) and part.isdigit() and int(part) < len(current):
            current = current[int(part)]
        else:
            return default
    return current


def unwrap_data(result: dict[str, Any]) -> dict[str, Any]:
    """兼容 data 包裹和直接返回两种 API 响应形态。"""

    data = result.get("data")
    return data if isinstance(data, dict) else result


def get_article_body(result: dict[str, Any]) -> str:
    """从生成结果里取正文，兼容同步/异步结果的轻微结构差异。"""

    data = unwrap_data(result)
    body = get_path(data, "draft.body")
    if not body:
        body = get_path(data, "result.draft.body")
    return str(body or "")


def get_materials_result(result: dict[str, Any]) -> dict[str, Any]:
    """校验 materials-only 响应，并要求 writingBrief 已可用于下一阶段。"""

    data = unwrap_data(result)
    materials = data.get("materials")
    if not isinstance(materials, dict):
        raise RuntimeError("materials-only result is missing materials")
    brief = str(materials.get("writingBrief") or "").strip()
    if len(brief) < 100:
        raise RuntimeError("materials-only result has no usable writingBrief")
    return data


def assert_agent_pipeline_model_contract(agent_pipeline: dict[str, Any]) -> None:
    """确保所有 agent 实际使用的 profile/model 与验收预期一致。"""

    config = agent_pipeline.get("config")
    if not isinstance(config, dict):
        raise RuntimeError("agent pipeline config metadata is missing")
    for name, cfg in config.items():
        if not isinstance(cfg, dict):
            continue
        profile = str(cfg.get("profile") or "")
        model = str(get_path(cfg, "model.model") or "")
        if profile.lower() != "deepseek":
            raise RuntimeError(f"Agent profile mismatch: {name} uses {profile}, expected deepseek")
        if ARGS.expected_model and model != ARGS.expected_model:
            raise RuntimeError(f"Agent model mismatch: {name} uses {model}, expected {ARGS.expected_model}")


def assert_article_result(result: dict[str, Any], resolved_topic: str) -> dict[str, Any]:
    """硬验收文章生成结果：正文、EvidencePack、模型和 agent 产物都必须达标。"""

    data = unwrap_data(result)
    body = get_article_body(result)
    if not body:
        raise RuntimeError("article result has no draft.body")
    pack = get_path(data, "context.evidence.pack")
    if not isinstance(pack, dict):
        raise RuntimeError("article result is missing EvidencePack")
    sources = pack.get("sources")
    chunks = pack.get("chunks")
    citations = pack.get("citations")
    if not sources or not chunks or not citations:
        raise RuntimeError("EvidencePack is missing sources/chunks/citations")
    model = str(get_path(data, "draft.modelInvocation.model") or "")
    if not model:
        raise RuntimeError("article result is missing Writer modelInvocation.model")
    if ARGS.expected_model and model != ARGS.expected_model:
        raise RuntimeError(f"Writer model mismatch: got {model}, expected {ARGS.expected_model}")
    sources_count = len(sources)
    chunks_count = len(chunks)
    citations_count = len(citations)
    if sources_count < ARGS.expected_sources or chunks_count != ARGS.expected_chunks or citations_count != ARGS.expected_citations:
        raise RuntimeError(
            f"EvidencePack count mismatch: sources/chunks/citations={sources_count}/{chunks_count}/{citations_count}, "
            f"expected sources>={ARGS.expected_sources} chunks={ARGS.expected_chunks} citations={ARGS.expected_citations}"
        )
    agent_pipeline = get_path(data, "draft.agentPipeline")
    if not isinstance(agent_pipeline, dict):
        raise RuntimeError("article result is missing draft.agentPipeline")
    if agent_pipeline.get("enabled") is not True:
        raise RuntimeError("agent pipeline is not enabled in result")
    writing_brief_chars = int(get_path(agent_pipeline, "material.writingBriefChars", 0) or 0)
    outline_route_chars = int(get_path(agent_pipeline, "writing.outlineRouteChars", 0) or 0)
    revision_chars = int(get_path(agent_pipeline, "review.revisionChars", 0) or 0)
    if writing_brief_chars < 100:
        raise RuntimeError("agent material stage did not produce a usable writing brief")
    if outline_route_chars < 100:
        raise RuntimeError("Outline Agent did not produce a usable writing route")
    if revision_chars < 100:
        raise RuntimeError("agent review/revision stage did not produce a usable revision")
    assert_agent_pipeline_model_contract(agent_pipeline)
    return {
        "Topic": resolved_topic,
        "BodyLength": len(body),
        "Model": model,
        "Sources": sources_count,
        "Chunks": chunks_count,
        "Citations": citations_count,
        "AgentBriefChars": writing_brief_chars,
        "AgentRevisionChars": revision_chars,
    }


def test_article_length(body: str) -> dict[str, Any]:
    """检查正文长度是否落在目标字数窗口内，并返回报告用的差额数据。"""

    expected_min, expected_max = resolve_length_window(ARGS.target_word_count)
    expected = int(ARGS.min_body_length or expected_min)
    if ARGS.min_body_length is not None:
        expected_min = expected
    ok = expected_min <= len(body) <= expected_max
    if not ok:
        write_step(f"article body outside target window: {len(body)}, expected {expected_min}-{expected_max}; saved body will be kept for review and acceptance will fail")
    return {
        "Ok": ok,
        "BodyLength": len(body),
        "ExpectedMin": expected_min,
        "ExpectedMax": expected_max,
        "Missing": max(0, expected_min - len(body)),
        "Overflow": max(0, len(body) - expected_max),
    }


def resolve_length_window(target_word_count: int) -> tuple[int, int]:
    """把目标字数转换为验收窗口，容忍度随目标字数增长但设上下限。"""

    target = max(1, int(target_word_count or 1))
    tolerance = min(1000, max(300, int(target * 0.125)))
    return max(1, target - tolerance), target + tolerance


def get_ragflow_recall(result: dict[str, Any]) -> dict[str, Any] | None:
    """提取 RAGFlow 召回诊断，兼容新版 context 和旧版 trace 位置。"""

    data = unwrap_data(result)
    return get_path(data, "context.ragflowRecall") or get_path(data, "trace.context.ragflowRecall")


def get_storm_diagnostics(result: dict[str, Any]) -> dict[str, Any] | None:
    """提取 STORM 研究规划诊断。"""

    data = unwrap_data(result)
    return get_path(data, "context.diagnostics.storm") or get_path(data, "trace.context.diagnostics.storm")


def get_agent_pipeline_diagnostics(result: dict[str, Any]) -> dict[str, Any] | None:
    """提取 agent 流水线诊断。"""

    data = unwrap_data(result)
    return get_path(data, "draft.agentPipeline") or get_path(data, "trace.agentPipeline")


def get_post_process_diagnostics(result: dict[str, Any]) -> dict[str, Any] | None:
    """提取格式清理和风格传感器诊断。"""

    data = unwrap_data(result)
    return get_path(data, "draft.postProcess") or get_path(data, "trace.postProcess")


def get_ending_diagnostics(result: dict[str, Any]) -> dict[str, Any] | None:
    """提取结尾闭合诊断。"""

    data = unwrap_data(result)
    return get_path(data, "trace.ending")


def assert_storm_diagnostics(storm: dict[str, Any] | None) -> None:
    """硬验收 STORM：必须启用、被调用，并产出足够视角/问题/引用。"""

    if not storm:
        raise RuntimeError("STORM diagnostics metadata is absent")
    if str(storm.get("status")) != ARGS.expected_storm_status:
        raise RuntimeError(f"STORM status mismatch: got {storm.get('status')}, expected {ARGS.expected_storm_status}")
    if storm.get("required") is not True:
        raise RuntimeError("STORM is not marked required in result diagnostics")
    if storm.get("called") is not True:
        raise RuntimeError("STORM was not called")
    if int(storm.get("perspectives") or 0) < ARGS.min_storm_perspectives:
        raise RuntimeError(f"STORM perspectives too low: got {storm.get('perspectives')}, expected at least {ARGS.min_storm_perspectives}")
    if int(storm.get("questions") or 0) < ARGS.min_storm_questions:
        raise RuntimeError(f"STORM questions too low: got {storm.get('questions')}, expected at least {ARGS.min_storm_questions}")
    if int(storm.get("citations") or 0) < ARGS.min_storm_citations:
        raise RuntimeError(f"STORM citations too low: got {storm.get('citations')}, expected at least {ARGS.min_storm_citations}")


def assert_ragflow_recall(recall: dict[str, Any] | None) -> None:
    """硬验收 RAGFlow：状态、健康、packed 单元和必需通道必须满足要求。"""

    if not recall:
        raise RuntimeError("RAGFlow recall metadata is absent")
    if str(recall.get("status")) != ARGS.expected_ragflow_status:
        raise RuntimeError(f"RAGFlow recall status mismatch: got {recall.get('status')}, expected {ARGS.expected_ragflow_status}")
    if recall.get("healthy") is not True:
        raise RuntimeError("RAGFlow recall is not healthy")
    recalled = int(recall.get("recalledUnits") or 0)
    packed = int(recall.get("packedUnits") or 0)
    if recalled < ARGS.min_ragflow_recalled_units:
        warn(
            f"RAGFlow recalledUnits below observation floor: got {recalled}, expected at least {ARGS.min_ragflow_recalled_units}; "
            "continuing because status/healthy/packedUnits/channel gates are authoritative."
        )
    if packed < ARGS.min_ragflow_packed_units:
        raise RuntimeError(f"RAGFlow packedUnits too low: got {packed}, expected at least {ARGS.min_ragflow_packed_units}")
    required = [x.strip() for x in ARGS.required_ragflow_channels.split(",") if x.strip()]
    loaded = [str(x) for x in recall.get("loadedChannels") or []]
    missing = [x for x in required if x not in loaded]
    if missing:
        raise RuntimeError(f"RAGFlow required channels missing: {','.join(missing)}, loaded=[{','.join(loaded)}]")


def assert_corpus_diagnostics(diagnostics: dict[str, Any]) -> None:
    """检查 DataBase corpus 诊断里至少有词汇材料可用。"""

    terms = int(get_path(diagnostics, "data.summary.vocabularyTerms", 0) or 0)
    coverage = str(get_path(diagnostics, "data.quality.completeness.vocabularyCoverage", "") or "")
    if terms < 1:
        raise RuntimeError("DataBase vocabularyTerms is empty in diagnostics")
    if coverage == "empty":
        write_step("warning: diagnostics vocabularyCoverage=empty; vector lexicon endpoint will still be required by RAGFlow channel assertion")


def format_storm_diagnostics(storm: dict[str, Any] | None) -> list[str]:
    """把 STORM 诊断转成保存到 Markdown 报告的段落。"""

    if not storm:
        return ["## STORM 研究规划", "- 状态：缺少元数据"]
    return [
        "## STORM 研究规划",
        f"- 状态：{storm.get('status')}",
        f"- 是否启用：{storm.get('enabled')}",
        f"- 是否必需：{storm.get('required')}",
        f"- 是否调用：{storm.get('called')}",
        f"- 研究视角数：{storm.get('perspectives')}",
        f"- 研究问题数：{storm.get('questions')}",
        f"- 提纲字符数：{storm.get('outlineChars')}",
        f"- 候选引用数：{storm.get('citations')}",
        f"- 错误信息：{storm.get('error') or '无'}",
    ]


def format_storm_diagnostics_one_line(storm: dict[str, Any] | None) -> str:
    """把 STORM 诊断压成日志里的一行摘要。"""

    if not storm:
        return "STORM research: metadata absent"
    return (
        f"STORM research: status={storm.get('status')} enabled={storm.get('enabled')} required={storm.get('required')} "
        f"called={storm.get('called')} perspectives={storm.get('perspectives')} questions={storm.get('questions')} "
        f"outlineChars={storm.get('outlineChars')} citations={storm.get('citations')} error={storm.get('error')}"
    )


def convert_agent_name_to_chinese(name: str) -> str:
    """把 agent 机器名转成报告里可读的中文职责说明。"""

    return {
        "fact_agent": "fact_agent，事实材料整理",
        "web_reality_agent": "web_reality_agent，网上现实材料",
        "divergence_agent": "divergence_agent，发散材料",
        "meaning_agent": "meaning_agent，主线理解",
        "outline_agent": "outline_agent，写作路线",
        "author_agent": "author_agent，正文写作",
        "enrichment_agent": "enrichment_agent，正文内部补充材料",
        "format_reviewer": "format_reviewer，格式审查",
        "fact_reviewer": "fact_reviewer，事实审稿",
        "style_reviewer": "style_reviewer，风格审稿",
        "revision_agent": "revision_agent，最终修订",
    }.get(name, name)


def convert_ragflow_channel_to_chinese(name: str) -> str:
    """把 RAGFlow channel 机器名转成中文标签。"""

    return {
        "reality": "现实材料",
        "literary": "文学/文风材料",
        "semantic": "语义召回",
        "lexicon": "词汇材料",
        "structure": "结构材料",
        "author": "作者画像",
    }.get(name, name)


def convert_severity_to_chinese(severity: str) -> str:
    """把风格信号严重度转成中文。"""

    return {"low": "低", "medium": "中", "high": "高"}.get(severity, severity)


STYLE_RULES = {
    # 风格信号字典只负责展示名称；规则检测仍由生产代码产生。
    "contrastive_negation_bushi_ershi": "机械二分句：不是……而是……",
    "contrastive_negation_zhebushi_zheshi": "机械二分句：这不是……这是……",
    "contrastive_negation_wentibuzaiyu": "机械二分句：问题不在于……而在于……",
    "contrastive_negation_zhenzhengde": "机械二分句：真正的问题不是……而是……",
    "contrastive_negation_biaomian_shiji": "表面/实际式转折",
    "contrastive_negation_yuqishuo": "与其说/不如说式转折",
    "contrastive_negation_ruguoshuo": "如果说/那么式转折",
    "mechanical_dualism_ouran_biran": "偶然/必然机械对偶",
    "translationese_bei_suo": "翻译腔：被……所……",
    "translationese_jinxing": "翻译腔：进行了",
    "translationese_zuowei_yige": "翻译腔：作为一个……",
    "translationese_dang_shihou": "翻译腔：当……的时候",
    "translationese_zhiyi": "翻译腔：……之一",
    "translationese_budebu": "翻译腔：不得不",
    "translationese_yuyi_jiyu": "翻译腔：予以/给予",
    "ai_connective_zhuanzhe": "AI 连接词：然而/但是/此外等",
    "ai_connective_yushici": "AI 连接词：与此同时/换句话说等",
    "ai_connective_pinglunqiang": "评论腔：值得注意的是/可以说等",
    "ai_connective_shoucu": "总结腔：总而言之/综上所述等",
    "ai_connective_taoyu": "套话强调：显而易见/毋庸置疑等",
    "punctuation_colon_explanatory": "标点偏好：中文冒号解释腔",
    "punctuation_dash_insert": "标点偏好：破折号插入语",
    "parenthetical_annotation_cn": "括号注释：中文小括号",
    "parenthetical_annotation_en": "括号注释：英文小括号",
    "ai_rhythm_single_sentence_para": "节奏问题：短金句独立成段",
    "comparison_matrix_paragraph_run": "讲义腔：连续比较矩阵段落",
    "ending_direct_address_question": "结尾语气：面向读者的口号式提问",
    "opening_missing_concrete_anchor": "开头现场：缺少具体锚点",
    "opening_abstract_subject": "开头现场：抽象概念发动",
    "format_markdown_heading": "格式问题：Markdown 标题",
    "format_chinese_section_heading": "格式问题：中文章节小标题",
    "format_numeric_section_heading": "格式问题：数字小标题",
    "format_internal_planning_label": "格式问题：内部规划标签泄漏",
}


STYLE_CATEGORIES = {
    # category 名称用于人工阅读报告，不参与通过/失败判断。
    "mechanical_contrast": "机械转折",
    "abstract_dualism": "抽象对偶",
    "unsourced_metaphor": "无来源比喻",
    "translationese": "翻译腔",
    "ai_connective": "AI 连接词",
    "ai_commentary": "评论腔",
    "source_attribution": "来源归属",
    "punctuation_style": "标点风格",
    "parenthetical_annotation": "括号注释",
    "format_structure": "格式结构",
    "rhythm": "段落节奏",
    "narrative_opening": "叙事开头",
    "lecture_tone": "讲义腔",
    "ending_tone": "结尾语气",
}


def style_rule(rule: str) -> str:
    """返回风格规则的中文展示名。"""

    return STYLE_RULES.get(rule, rule)


def style_category(category: str) -> str:
    """返回风格类别的中文展示名。"""

    return STYLE_CATEGORIES.get(category, category)


def format_agent_pipeline_diagnostics(agent_pipeline: dict[str, Any] | None) -> list[str]:
    """格式化 agent 各阶段产物规模，帮助判断材料/写作/审稿是否真的跑过。"""

    if not agent_pipeline:
        return ["## Agent 流水线", "- 状态：缺少元数据"]
    material = agent_pipeline.get("material") or {}
    writing = agent_pipeline.get("writing") or {}
    review = agent_pipeline.get("review") or {}
    return [
        "## Agent 流水线",
        f"- 是否启用：{agent_pipeline.get('enabled')}",
        f"- fact_agent 事实底稿字符数：{material.get('factNotesChars')}",
        f"- web_reality_agent 现实材料字符数：{material.get('webRealityNotesChars')}",
        f"- divergence_agent 发散材料字符数：{material.get('divergenceNotesChars')}",
        f"- meaning_agent 主线理解字符数：{material.get('meaningNotesChars')}",
        f"- Writing Brief 写作简报字符数：{material.get('writingBriefChars')}",
        f"- outline_agent 写作路线字符数：{writing.get('outlineRouteChars')}",
        f"- author_agent 初稿字符数：{writing.get('draftBodyChars')}",
        f"- enrichment_agent 调用次数：{writing.get('enrichmentCalls')}",
        f"- enrichment_agent 补充后正文字符数：{writing.get('enrichmentChars')}",
        f"- format_reviewer 格式审稿字符数：{review.get('formatReviewChars')}",
        f"- fact_reviewer 事实审稿字符数：{review.get('factReviewChars')}",
        f"- style_reviewer 风格审稿字符数：{review.get('styleReviewChars')}",
        f"- revision_agent 修订稿字符数：{review.get('revisionChars')}",
    ]


def format_agent_config_diagnostics(agent_pipeline: dict[str, Any] | None) -> list[str]:
    """格式化每个 agent 的模型配置，便于复盘模型漂移。"""

    config = agent_pipeline.get("config") if isinstance(agent_pipeline, dict) else None
    if not isinstance(config, dict):
        return ["## Agent 模型配置", "- 状态：缺少元数据"]
    lines = ["## Agent 模型配置"]
    for name in sorted(config):
        cfg = config.get(name) or {}
        lines.extend([
            f"- {convert_agent_name_to_chinese(name)}：",
            f"  - profile：{cfg.get('profile')}",
            f"  - model：{get_path(cfg, 'model.model', '')}",
            f"  - baseUrl：{get_path(cfg, 'model.baseUrl', '')}",
            f"  - temperature：{cfg.get('temperature')}",
            f"  - maxTokens：{cfg.get('maxTokens')}",
            f"  - 职责：{cfg.get('role')}",
        ])
    return lines


def convert_repair_verdict_to_chinese(verdict: str) -> str:
    """把自动修复评估结论转成中文描述。"""

    return {
        "effective": "有效：可修复残留已清零",
        "partial": "部分有效：残留减少但仍有剩余",
        "unchanged": "无明显改善：修复前后数量未下降",
        "regressed": "变差：修复后残留反而增加",
        "skipped": "跳过：修复前没有可修复残留",
    }.get(verdict, verdict)


def format_style_diagnostics(post_process: dict[str, Any] | None, max_examples: int = 12) -> list[str]:
    """格式化风格传感器输出；这是复查材料，不是本文的通过条件主引擎。"""

    if not post_process:
        return ["## 风格信号", "- 状态：缺少元数据"]
    lines = ["## 风格信号"]
    summary = post_process.get("summary")
    style_violations = post_process.get("styleViolations") or []
    log = [x for x in (post_process.get("log") or []) if x]
    lines.append(f"- 信号总数：{len(style_violations)}")
    lines.append("- 信号统计：")
    if isinstance(summary, dict) and summary:
        for name in sorted(summary):
            lines.append(f"  - {style_rule(name)}：{summary[name]}")
    else:
        lines.append("  - 无")
    lines.append(f"- 后处理日志：{'；'.join(map(str, log)) if log else '无'}")
    repair = post_process.get("repairEvaluation")
    if isinstance(repair, dict):
        lines.extend([
            "",
            "## 自动格式/句法修复评估",
            f"- 是否执行自动修复：{repair.get('enabled')}",
            f"- 结论：{convert_repair_verdict_to_chinese(str(repair.get('verdict') or ''))}",
            f"- 修复前总命中数：{repair.get('beforeTotal')}",
            f"- 修复后总命中数：{repair.get('afterTotal')}",
            f"- 总命中减少：{repair.get('reducedTotal')}",
            f"- 总命中减少比例：{round(float(repair.get('totalReductionRatio') or 0) * 100, 1)}%",
            f"- 修复前可修复命中数：{repair.get('beforeRepairable')}",
            f"- 修复后可修复命中数：{repair.get('afterRepairable')}",
            f"- 可修复命中减少：{repair.get('reducedRepairable')}",
            f"- 可修复命中减少比例：{round(float(repair.get('repairableReductionRatio') or 0) * 100, 1)}%",
        ])
        for key, title in [("beforeSummary", "- 修复前规则统计："), ("afterSummary", "- 修复后规则统计：")]:
            val = repair.get(key)
            if isinstance(val, dict):
                lines.append(title)
                for name in sorted(val):
                    lines.append(f"  - {style_rule(name)}：{val[name]}")
    profile = post_process.get("styleProfile")
    if isinstance(profile, dict):
        lines.extend([
            "",
            "## 文体画像",
            f"- AI 残留分数：{profile.get('aiResidueScore')}",
            f"- 每千字风格信号密度：{profile.get('violationDensityPerThousand')}",
            f"- 每千字连接词密度：{profile.get('connectiveDensityPerThousand')}",
            f"- 平均句长：{profile.get('avgSentenceLength')}",
            f"- 句长波动：{profile.get('sentenceLengthStdDev')}",
            f"- 长句比例：{profile.get('longSentenceRatio')}",
            f"- 短段比例：{profile.get('shortParagraphRatio')}",
        ])
        for key, label in [
            ("openingHasConcreteAnchor", "开头是否有具体锚点"),
            ("openingAbstractSubject", "开头是否由抽象概念发动"),
            ("concreteAnchorParagraphRatio", "有具体锚点的段落比例"),
            ("abstractSubjectParagraphRatio", "抽象主语段比例"),
        ]:
            if key in profile:
                lines.append(f"- {label}：{profile.get(key)}")
    ai_rules = set(STYLE_RULES) | {"source_attribution_anonymous_voice"}
    ai_residues = [x for x in style_violations if isinstance(x, dict) and str(x.get("rule")) in ai_rules]
    lines.extend(["", "## 需人工复查的句式和标点样例"])
    if not ai_residues:
        lines.append("- 状态：未发现样例")
    else:
        for i, item in enumerate(ai_residues[:max_examples], start=1):
            match = str(item.get("match") or "").replace("\r", " ").replace("\n", " ").strip()
            advice = str(item.get("advice") or "").replace("\r", " ").replace("\n", " ").strip()
            lines.extend([
                f"{i}. {style_rule(str(item.get('rule') or ''))}",
                f"   - 类型：{style_category(str(item.get('category') or ''))}",
                f"   - 严重度：{convert_severity_to_chinese(str(item.get('severity') or ''))}",
                f"   - 命中文本：{match}",
            ])
            if advice:
                lines.append(f"   - 修改建议：{advice}")
        if len(ai_residues) > max_examples:
            lines.append(f"- 还有 {len(ai_residues) - max_examples} 条未展示")
    return lines


def format_source_boundary_diagnostics(body: str, max_examples: int = 12) -> list[str]:
    """扫描正文里的未证实延伸、万能解释和来源边界可疑句。"""

    lines = ["## 来源边界扫描"]
    sentences = [x.strip() for x in re.split(r"(?<=[。！？；])", body) if x.strip()]
    future_hits = [x for x in sentences if re.search(r"(2025|2026|2027|2028|2029|2030|将发布|将宣布|将开始|开始使用人工智能|无人机飞过|算法自动|趋势预测|人口预测)", x)]
    universal_hits = [x for x in sentences if re.search(r"(一切|全部|所有|都归因于|都是.+副产品|万能|最终体现|可以.+但无法.+可以.+但无法|一个概念|同一概念|单一框架)", x)]
    lines.extend([f"- 近未来或未证实延伸命中：{len(future_hits)}", f"- 万能解释/对称升华命中：{len(universal_hits)}"])
    if future_hits:
        lines.append("- 近未来或未证实延伸样例：")
        lines.extend([f"  {i}. {hit}" for i, hit in enumerate(future_hits[:max_examples], start=1)])
    if universal_hits:
        lines.append("- 万能解释/对称升华样例：")
        lines.extend([f"  {i}. {hit}" for i, hit in enumerate(universal_hits[:max_examples], start=1)])
    if not future_hits and not universal_hits:
        lines.append("- 状态：未发现样例")
    return lines


def format_ending_diagnostics(ending: dict[str, Any] | None) -> list[str]:
    """格式化结尾闭合诊断，方便人工读尾段时定位问题。"""

    if not ending:
        return ["## 结尾诊断", "- 状态：缺少元数据"]
    reasons = [str(x) for x in (ending.get("reasons") or []) if x]
    tail = str(ending.get("bodyTail") or "").replace("\r", " ").replace("\n", " ").strip()
    return [
        "## 结尾诊断",
        f"- 是否闭合：{ending.get('closed')}",
        f"- 有效正文长度：{ending.get('effectiveLength')}",
        f"- 判断原因：{'；'.join(reasons) if reasons else '无'}",
        f"- 结尾截取：{tail}",
    ]


def count_text_occurrences(text: str, needle: str) -> int:
    """统计固定短语出现次数；空输入直接视为 0。"""

    return text.count(needle) if text and needle else 0


def format_self_quality_assessment(body: str, post_process: dict[str, Any] | None, length_check: dict[str, Any], ending: dict[str, Any] | None) -> list[str]:
    """基于正文和诊断信号生成脚本自评，作为人工复查前的快速索引。"""

    paragraphs = [x.strip() for x in re.split(r"\r?\n\s*\r?\n", body) if x.strip()]
    first_para = paragraphs[0] if paragraphs else ""
    last_para = paragraphs[-1] if paragraphs else ""
    style_violations = post_process.get("styleViolations") if isinstance(post_process, dict) else []
    if not isinstance(style_violations, list):
        style_violations = []
    anonymous_refs = sum(count_text_occurrences(body, x) for x in ["有论者", "有研究认为", "有学者"])
    source_boundary_dirty = sum(count_text_occurrences(body, x) for x in ["讲谈社", "Baseline", "ContentMRS"])
    bushi = count_text_occurrences(body, "不是")
    ershi = count_text_occurrences(body, "而是")
    zhezhong = count_text_occurrences(body, "这种")
    source_signals = len([x for x in style_violations if isinstance(x, dict) and x.get("category") == "source_attribution"])
    opening_concrete = bool(re.search(r"[0-9一二三四五六七八九十百千万亿]{2,}|年|月|日|法|条例|国会|政府|铁路|土地|条约|文件|美元|英里|英亩", first_para))
    ending_closed = bool(ending and ending.get("complete"))
    good: list[str] = []
    bad: list[str] = []
    if length_check["Ok"]:
        good.append(f"正文长度达到要求：{length_check['BodyLength']} 字，最低要求 {length_check['ExpectedMin']} 字。")
    else:
        bad.append(f"正文长度不足：{length_check['BodyLength']} 字，缺口 {length_check['Missing']} 字。")
    (good if opening_concrete else bad).append("开头有具体锚点，能从时间、文件、制度动作或物理现场进入。" if opening_concrete else "开头具体锚点偏弱，容易滑成题目解释或概念开场。")
    if anonymous_refs == 0 and source_boundary_dirty == 0 and source_signals == 0:
        good.append("未发现匿名半引用或已知来源容器误署名。")
    else:
        bad.append(f"来源归属仍需复查：匿名半引用={anonymous_refs}，容器/脏来源信号={source_boundary_dirty}，来源归属信号={source_signals}。")
    (good if len(style_violations) <= 10 else bad).append(f"风格信号数量较低：{len(style_violations)} 条。" if len(style_violations) <= 10 else f"风格信号仍偏多：{len(style_violations)} 条，需人工判断是否影响正文活力。")
    (good if bushi <= 15 and ershi <= 8 else bad).append(f"二分句残留处于可人工复查范围：不是={bushi}，而是={ershi}。" if bushi <= 15 and ershi <= 8 else f"二分句残留偏高：不是={bushi}，而是={ershi}，可能仍有解释腔。")
    (good if zhezhong <= 30 else bad).append(f"这种等抽象承接词未明显泛滥：{zhezhong} 次。" if zhezhong <= 30 else f"这种等抽象承接词偏多：{zhezhong} 次，可能说明段落靠概念回环推进。")
    (good if ending_closed else bad).append("结尾诊断判定为闭合。" if ending_closed else "结尾闭合诊断未通过或缺失，需要人工读尾段。")
    if re.search(r"值得继续追问|永远不会结束|没有最终的答案|探索", last_para):
        bad.append("结尾疑似通用升华或准备式追问，需要压回具体事实后果。")
    if not good:
        good.append("未形成明确正向质量信号。")
    if not bad:
        bad.append("未发现明显结构性坏信号；仍建议人工读正文判断作者声部和生气。")
    return ["## contentbase-acceptance.py 自评", "### 好的地方", *[f"- {x}" for x in good], "### 需要复查或改进的地方", *[f"- {x}" for x in bad]]


def format_ragflow_recall(recall: dict[str, Any] | None) -> str:
    """把 RAGFlow 召回压成日志一行摘要。"""

    if not recall:
        return "RAGFlow recall: metadata absent (服务未返回 context.ragflowRecall)"
    channel_parts = []
    channels = recall.get("channels")
    if isinstance(channels, dict):
        for name in ["literary", "semantic", "lexicon", "structure", "author"]:
            ch = channels.get(name)
            if isinstance(ch, dict):
                channel_parts.append(f"{name}={ch.get('packed')}/{ch.get('recalled')}")
    channel_text = " ".join(channel_parts) if channel_parts else "no channel detail"
    return (
        f"RAGFlow recall: status={recall.get('status')} healthy={recall.get('healthy')} packedUnits={recall.get('packedUnits')} "
        f"recalledUnits={recall.get('recalledUnits')} loaded=[{','.join(map(str, recall.get('loadedChannels') or []))}] "
        f"empty=[{','.join(map(str, recall.get('emptyChannels') or []))}] channels(packed/recalled): {channel_text}"
    )


def format_ragflow_recall_markdown(recall: dict[str, Any] | None) -> list[str]:
    """把 RAGFlow 召回展开成 Markdown 报告段落。"""

    if not recall:
        return ["## RAGFlow 召回", "- 状态：缺少元数据"]
    loaded = [convert_ragflow_channel_to_chinese(str(x)) for x in (recall.get("loadedChannels") or [])]
    empty = [convert_ragflow_channel_to_chinese(str(x)) for x in (recall.get("emptyChannels") or [])]
    lines = [
        "## RAGFlow 召回",
        f"- 状态：{recall.get('status')}",
        f"- 是否健康：{recall.get('healthy')}",
        f"- 打包进上下文的资料单元数：{recall.get('packedUnits')}",
        f"- 原始召回资料单元数：{recall.get('recalledUnits')}",
        f"- 有内容的通道：{'，'.join(loaded) if loaded else '无'}",
        f"- 空通道：{'，'.join(empty) if empty else '无'}",
    ]
    channels = recall.get("channels")
    if isinstance(channels, dict):
        lines.append("- 各通道打包/召回：")
        for name in ["reality", "literary", "semantic", "lexicon", "structure", "author"]:
            ch = channels.get(name)
            if isinstance(ch, dict):
                lines.append(f"  - {convert_ragflow_channel_to_chinese(name)}：{ch.get('packed')}/{ch.get('recalled')}")
    return lines


def get_review_model_service(profile: str, prefix: str) -> dict[str, Any]:
    """按 profile/env 前缀解析外部复评模型服务配置。"""

    normalized = profile.strip().upper()
    if not normalized:
        return {"ok": False, "missing": ["model service not configured"]}
    base_url = os.environ.get(f"CONTENTBASE_LLM_{normalized}_BASE_URL", "")
    api_key = os.environ.get(f"CONTENTBASE_LLM_{normalized}_API_KEY", "")
    model = os.environ.get(f"{prefix}_MODEL", "") or os.environ.get(f"CONTENTBASE_LLM_{normalized}_MODEL", "")
    missing = []
    if not base_url:
        missing.append(f"CONTENTBASE_LLM_{normalized}_BASE_URL")
    if not api_key:
        missing.append(f"CONTENTBASE_LLM_{normalized}_API_KEY")
    if not model:
        missing.append(f"{prefix}_MODEL or CONTENTBASE_LLM_{normalized}_MODEL")
    if missing:
        return {"ok": False, "profile": normalized.lower(), "baseUrl": base_url, "apiKey": api_key, "model": model, "missing": missing}
    return {"ok": True, "profile": normalized.lower(), "baseUrl": base_url.rstrip("/"), "apiKey": api_key, "model": model, "missing": []}


def record_soft_warning(message: str) -> None:
    """记录不阻断验收的外部复评问题。"""

    SOFT_WARNINGS.append(message)


def invoke_chat_completion_review(service: dict[str, Any], system_prompt: str, user_prompt: str, max_tokens: int = 1600, temperature: float = 0.1, label: str = "AI") -> str:
    """调用外部 AI 复评；失败只记软告警，不覆盖正文验收结果。"""

    result = _invoke_chat_completion_review(service, system_prompt, user_prompt, max_tokens, temperature)
    if result.startswith("复评调用失败") or result.startswith("复评未执行") or result.startswith("复评未返回正文"):
        record_soft_warning(f"{label}复评未跑成: {result[:80]}")
    return result


def _invoke_chat_completion_review(service: dict[str, Any], system_prompt: str, user_prompt: str, max_tokens: int = 1600, temperature: float = 0.1) -> str:
    """执行 OpenAI-compatible chat/completions 请求，并返回可写入报告的文本。"""

    if not service or not service.get("ok"):
        missing = ", ".join(service.get("missing") or ["model service not configured"]) if service else "model service not configured"
        return f"复评未执行：{missing}"
    body = {
        "model": service["model"],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
    }
    last_error = ""
    for attempt in range(2):
        try:
            headers = {"Authorization": f"Bearer {service['apiKey']}", "Accept": "application/json", "Content-Type": "application/json"}
            request = urllib.request.Request(f"{service['baseUrl']}/chat/completions", data=json.dumps(body, ensure_ascii=False).encode("utf-8"), method="POST", headers=headers)
            with urllib.request.urlopen(request, timeout=ARGS.ai_review_timeout_sec) as response:
                parsed = json.loads(response.read().decode("utf-8"))
            content = str(get_path(parsed, "choices.0.message.content") or "")
            if not content.strip():
                return "复评未返回正文。"
            return content.strip()
        except urllib.error.HTTPError as exc:
            payload = exc.read().decode("utf-8", errors="replace")
            return f"复评调用失败：HTTP {exc.code} {exc.reason} {payload[:500]}"
        except Exception as exc:
            last_error = format_exception_chain(exc)
            if attempt == 0:
                time.sleep(5)
    return f"复评调用失败：{last_error}"


def format_exception_chain(exc: BaseException) -> str:
    """把异常及其 cause/context 串起来，保留远程/HTTP 错误根因。"""

    parts = []
    current: BaseException | None = exc
    while current:
        parts.append(f"{current.__class__.__name__}: {current}")
        current = current.__cause__ or current.__context__
    return " | ".join(parts)


def format_codex_project_context_brief(
    resolved_base_url: str,
    source_commit: str,
    job_id: str,
    resolved_topic: str,
    summary: dict[str, Any],
    storm: dict[str, Any] | None,
    recall: dict[str, Any] | None,
    agent_pipeline: dict[str, Any] | None,
    post_process: dict[str, Any] | None,
) -> list[str]:
    """生成给 Claude 复盘看的工程上下文简报；它只解释链路，不参与正文生成。"""

    local_head = get_git_head(REPO_ROOT)
    local_branch = get_git_branch(REPO_ROOT)
    dirty_state = "dirty" if get_git_status_short(REPO_ROOT).strip() else "clean"
    writer_model = summary.get("Model") or "unknown"
    review_model = os.environ.get("CONTENTBASE_REVIEW_CLAUDE_MODEL") or os.environ.get("CONTENTBASE_LLM_CLAUDE_MODEL", "")
    loaded = ",".join(map(str, recall.get("loadedChannels") or [])) if recall else "unknown"
    empty = ",".join(map(str, recall.get("emptyChannels") or [])) if recall else "unknown"
    channel_lines: list[str] = []
    channels = recall.get("channels") if isinstance(recall, dict) else None
    if isinstance(channels, dict):
        for name in ["reality", "literary", "semantic", "lexicon", "structure", "author"]:
            ch = channels.get(name)
            if isinstance(ch, dict):
                channel_lines.append(f"  - {convert_ragflow_channel_to_chinese(name)}：packed={ch.get('packed')}，recalled={ch.get('recalled')}")
    if not channel_lines:
        channel_lines = ["  - 缺少 channel 明细"]
    material = agent_pipeline.get("material") if isinstance(agent_pipeline, dict) else {}
    writing = agent_pipeline.get("writing") if isinstance(agent_pipeline, dict) else {}
    review = agent_pipeline.get("review") if isinstance(agent_pipeline, dict) else {}
    style_count = len(post_process.get("styleViolations") or []) if isinstance(post_process, dict) else 0
    style_profile = post_process.get("styleProfile") if isinstance(post_process, dict) else None
    return [
        "## Codex 项目上下文简报",
        "- 用途：给 Claude 复盘补充工程上下文；只做解释，不参与正文生成、不参与通过条件。",
        "- 验收入口：tests/contentbase-acceptance.py 是 ContentBase 当前 canonical 生产验收入口。",
        f"- 生产地址：{resolved_base_url}",
        f"- 本次 job：{job_id or 'sync'}",
        f"- 主题：{resolved_topic}",
        f"- 远程部署 commit：{source_commit}",
        f"- 本地仓库：branch={local_branch} head={local_head} status={dirty_state}",
        f"- 正文生成主模型：{writer_model}",
        f"- Claude 复盘模型：{review_model}",
        "",
        "### 当前生成链路",
        "- HTTP 请求进入 article generation runtime。",
        "- buildArticleContextEngine 负责资料阶段：STORM research planner、research query expansion、DataBase Gateway EvidencePack、RAGFlow/corpus retrieval、association expansion、ContextItem normalize、source authority、rank/dedupe、budget compose、sections、buildWriterPrompt。",
        "- Planning owner agents 读取 context：fact_agent、web_reality_agent、divergence_agent 并行形成三类材料，meaning_agent 合成上下文，Brief Builder 汇总 writingBrief。",
        "- outline_agent 使用 writingBrief 形成写作路线；author_agent 使用 context.prompt + writingBrief + outlineRoute 写正文主体。",
        "- enrichment_agent 属于 Writing 层；只有短稿需要补充时，它读取完整正文和事实边界，在文章内部均匀补料并输出完整正文，不做尾部机械续写。",
        "- Review 层分成 format_reviewer、fact_reviewer 和 style_reviewer；revision_agent 根据 reviewReport 修订。",
        "- Postprocess 是 sensor/format cleanup，不是主要 repair engine；检测附录不进入 draft.body。",
        "",
        "### 本次资料覆盖",
        f"- EvidencePack：sources={summary.get('Sources')}，chunks={summary.get('Chunks')}，citations={summary.get('Citations')}",
        f"- STORM：status={storm.get('status') if storm else None}，perspectives={storm.get('perspectives') if storm else None}，questions={storm.get('questions') if storm else None}，citations={storm.get('citations') if storm else None}",
        f"- RAGFlow：status={recall.get('status') if recall else None}，healthy={recall.get('healthy') if recall else None}，recalledUnits={recall.get('recalledUnits') if recall else None}，packedUnits={recall.get('packedUnits') if recall else None}",
        f"- RAGFlow loaded channels：{loaded}",
        f"- RAGFlow empty channels：{empty}",
        "- RAGFlow channel detail：",
        *channel_lines,
        "",
        "### Agent 产物规模",
        f"- Fact Agent notes chars：{material.get('factNotesChars') if isinstance(material, dict) else None}",
        f"- Web Reality Agent notes chars：{material.get('webRealityNotesChars') if isinstance(material, dict) else None}",
        f"- Divergence Agent notes chars：{material.get('divergenceNotesChars') if isinstance(material, dict) else None}",
        f"- Meaning Agent notes chars：{material.get('meaningNotesChars') if isinstance(material, dict) else None}",
        f"- Writing Brief chars：{material.get('writingBriefChars') if isinstance(material, dict) else None}",
        f"- Outline Route chars：{writing.get('outlineRouteChars') if isinstance(writing, dict) else None}",
        f"- Draft body chars：{writing.get('draftBodyChars') if isinstance(writing, dict) else None}",
        f"- Enrichment calls：{writing.get('enrichmentCalls') if isinstance(writing, dict) else None}",
        f"- Enrichment chars：{writing.get('enrichmentChars') if isinstance(writing, dict) else None}",
        f"- Format Review chars：{review.get('formatReviewChars') if isinstance(review, dict) else None}",
        f"- Fact Review chars：{review.get('factReviewChars') if isinstance(review, dict) else None}",
        f"- Style Review chars：{review.get('styleReviewChars') if isinstance(review, dict) else None}",
        f"- Revision chars：{review.get('revisionChars') if isinstance(review, dict) else None}",
        f"- 最终风格信号数：{style_count}",
        f"- AI residue score：{style_profile.get('aiResidueScore') if isinstance(style_profile, dict) else 'missing'}",
        "",
        "### 关联模块边界",
        "- src/article/runtime/article-runtime.ts：文章生成业务入口壳，负责请求归一、context 构建、调用 agent flow 和返回结果。",
        "- src/article/runtime/article-flow.ts：Planning/Writing/Post-Writing Review 的 11-agent 流程 owner。",
        "- src/article/registry/：agent/tool 注册声明，只记录产物 owner、能力边界和 stage 约束。",
        "- src/article/tools/：LLM、HTTP、DataBase、STORM 等工具能力实现，不拥有文章产物。",
        "- src/article/planning/：context builder、规划阶段共享类型和文本工具。",
        "- src/article/context/：source authority、writer context 生成和 context diagnostics。",
        "- src/article/agents/planning/：fact_agent、web_reality_agent、divergence_agent、meaning_agent owners。",
        "- src/article/agents/writing/：outline_agent、author_agent、enrichment_agent owners。",
        "- src/article/agents/review/：format_reviewer、fact_reviewer、style_reviewer、revision_agent owners and review sensors。",
        "- src/article/agents/prompts/：按 planning/writing/review/shared 分层的 prompt owner。",
        "- src/article/postprocess/：格式清理和质量传感器；不应作为正文重写主力。",
        "- tests/contentbase-acceptance.py：生产验收、检测附录、外部 AI 复评；不是生成链路。",
        "",
        "### 已知工程约束",
        "- 不通过减少 agent、减少召回、降低字数来伪改善质量。",
        "- 不新增硬编码题材表、禁词表或单篇特判。",
        "- 不让 validator/postprocess/gate 成为主要修文机关。",
        "- 不把检测附录写入发布正文。",
        "- RAGFlow 资料覆盖是变量：某题材 channel 为空或 packedUnits 偏低时，Claude 应把它当资料条件，而不是直接归咎 writer。",
        "- 历史经验：简单提高 temperature/top_p 曾是负实验；过度清洗标点/连接词可能压掉文章活力。",
    ]


def format_external_ai_review_diagnostics(body: str, diagnostic_lines_without_external_review: list[str], codex_context_brief_lines: list[str]) -> list[str]:
    """生成 DeepSeek/Claude 外部复评附录；复评失败只成为软告警。"""

    deepseek = get_review_model_service("DEEPSEEK", "CONTENTBASE_REVIEW_DEEPSEEK")
    claude_profile = os.environ.get("CONTENTBASE_REVIEW_CLAUDE_PROFILE") or "CLAUDE"
    claude = get_review_model_service(claude_profile, "CONTENTBASE_REVIEW_CLAUDE")
    deepseek_question = f"请判断下面这篇中文文章是否像 AI 写的。不要改写正文。请用短报告回答：1. 判断；2. 主要证据；3. 最不像 AI 的地方；4. 最像 AI 的地方。\n\n[正文]\n{body}"
    deepseek_answer = invoke_chat_completion_review(
        deepseek,
        "你是严苛的中文文章 AI 痕迹评估者。只评估，不润色，不重写。",
        deepseek_question,
        max_tokens=1400,
        temperature=0.1,
        label="DeepSeek",
    )
    full_for_claude = "\n".join([
        body,
        "",
        "---",
        "<!-- ContentBase 生成检测(测试复查用,非发布正文) -->",
        "\n".join(diagnostic_lines_without_external_review),
        "",
        "## DeepSeek AI 痕迹判断",
        "- 问题：这是 AI 写的吗？",
        f"- 模型：{deepseek.get('model')}",
        "",
        deepseek_answer,
        "",
        "\n".join(codex_context_brief_lines),
    ])
    claude_question = f"""我的追求是达到一流大师作品，并且没有 AI 味道。
请在不人为降低质量、不是把文章写糙、也不是减少材料能力的前提下，评估下面这个 ContentBase 产物。
请分别回答：
1. 文章本身好的地方；
2. 文章本身的 AI 味和生气不足在哪里；
3. 在单纯提升生气、判断力、作者性和文学执行的前提下，文章有什么改进空间；
4. 程序整体有什么改进空间；
5. 哪些检测或修复会过度工程化、反而压掉文章活力。

{full_for_claude}
"""
    claude_answer = invoke_chat_completion_review(
        claude,
        "你是顶级中文长文编辑、历史写作评论者和生成系统审稿人。只给诊断和改进方向，不重写正文。",
        claude_question,
        max_tokens=2600,
        temperature=0.1,
        label="Claude",
    )
    return [
        "## DeepSeek AI 痕迹判断",
        "- 问题：这是 AI 写的吗？",
        f"- 模型：{deepseek.get('model')}",
        "",
        deepseek_answer,
        "",
        *codex_context_brief_lines,
        "",
        "## Claude Opus 质量复盘",
        "- 问题：我的追求是达到一流大师作品，并且没有 AI 味道，请问在不人为降低质量而是单纯提升生气的情况下，文章有什么改进空间，程序整体有什么改进空间？",
        f"- 模型：{claude.get('model')}",
        f"- profile：{claude.get('profile')}",
        "",
        claude_answer,
    ]


def wait_article_job(resolved_base_url: str, job_id: str) -> dict[str, Any]:
    """轮询异步文章任务，直到 finished/failed 或整体超时。"""

    deadline = datetime.now() + timedelta(seconds=ARGS.timeout_sec)
    while datetime.now() < deadline:
        try:
            response = invoke_json_request("GET", f"{resolved_base_url}/api/content/runtime/generate/article/jobs/{urllib.parse.quote(job_id, safe='')}", request_timeout_sec=120)
        except Exception as exc:
            write_step(f"job {job_id} status poll failed; retrying: {exc}")
            time.sleep(ARGS.poll_interval_sec)
            continue
        job = response.get("data") or {}
        write_step(f"job {job_id} status={job.get('status')} stage={job.get('stage')} message={job.get('lastMessage')}")
        if job.get("status") == "finished":
            return job
        if job.get("status") == "failed":
            raise RuntimeError(f"article job failed: {job.get('error')}")
        time.sleep(ARGS.poll_interval_sec)
    raise RuntimeError(f"article job {job_id} did not finish within {ARGS.timeout_sec}s")


def save_article_body(body: str, resolved_topic: str, diagnostic_lines: list[str]) -> Path:
    """保存正文和测试诊断附录；诊断附录不属于发布正文。"""

    ARGS.save_dir.mkdir(parents=True, exist_ok=True)
    slug = re.sub(r'[\\/:*?"<>|\r\n]', "_", resolved_topic).strip()
    if len(slug) > 40:
        slug = slug[:40]
    if not slug:
        slug = "article"
    path = ARGS.save_dir / f"contentbase-{slug}-http-{RUN_ID or f'{datetime.now():%Y%m%d-%H%M%S}'}.md"
    content = body
    clean = [x for x in diagnostic_lines if x]
    if clean:
        content = f"{body}\n\n---\n<!-- ContentBase 生成检测(测试复查用,非发布正文) -->\n" + "\n".join(clean) + "\n"
    path.write_text(content, encoding="utf-8-sig")
    write_step(f"saved article ({len(body)} chars) to {path}")
    return path


def save_materials_result(result: dict[str, Any], resolved_topic: str) -> Path:
    """保存 materials-only 阶段的 Markdown 和完整 JSON 结果。"""

    ARGS.save_dir.mkdir(parents=True, exist_ok=True)
    slug = re.sub(r'[\\/:*?"<>|\r\n]', "_", resolved_topic).strip()
    if len(slug) > 40:
        slug = slug[:40]
    if not slug:
        slug = "article"
    data = get_materials_result(result)
    materials = data["materials"]
    recall = get_ragflow_recall(result)
    storm = get_storm_diagnostics(result)
    md_path = ARGS.save_dir / f"contentbase-{slug}-materials-{datetime.now():%Y%m%d-%H%M%S}.md"
    json_path = md_path.with_suffix(".json")
    sections = [
        f"# {resolved_topic} - 第一阶段资料",
        "",
        "## 摘要",
        f"- Topic: {data.get('topic') or resolved_topic}",
        f"- TargetWordCount: {data.get('targetWordCount')}",
        f"- STORM: {storm.get('status') if storm else 'absent'}",
        f"- RAGFlow: {recall.get('status') if recall else 'absent'} recalled={recall.get('recalledUnits') if recall else None} packed={recall.get('packedUnits') if recall else None}",
        "",
        "## Fact Agent",
        str(materials.get("factNotes") or "").strip(),
        "",
        "## Web Reality Agent",
        str(materials.get("webRealityNotes") or "").strip(),
        "",
        "## Divergence Agent",
        str(materials.get("divergenceNotes") or "").strip(),
        "",
        "## Meaning Agent",
        str(materials.get("meaningNotes") or "").strip(),
        "",
        "## Writing Brief",
        str(materials.get("writingBrief") or "").strip(),
    ]
    md_path.write_text("\n".join(sections).strip() + "\n", encoding="utf-8-sig")
    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8-sig")
    write_step(f"saved materials to {md_path}")
    write_step(f"saved materials json to {json_path}")
    return md_path


def publish_acceptance_example_and_tag(saved_path: Path, resolved_tag: str, job_id: str, body_length: int, expected_min: int) -> str:
    """把通过验收的样例纳入 docs/examples，并发布带证据信息的 tag。"""

    if not saved_path.exists():
        raise RuntimeError(f"cannot attach acceptance example; saved article not found: {saved_path}")
    tag_name = resolved_tag or f"contentbase-acceptance-{datetime.now():%Y%m%d-%H%M%S}"
    if not re.match(r"^contentbase-acceptance-[0-9]{8}-[0-9]{6}$", tag_name):
        raise RuntimeError(f"AcceptanceTag must match contentbase-acceptance-yyyyMMdd-HHmmss, got: {tag_name}")
    example_dir = REPO_ROOT / "docs/examples"
    example_dir.mkdir(parents=True, exist_ok=True)
    example_path = example_dir / f"{tag_name}.md"
    shutil.copyfile(saved_path, example_path)
    invoke_git(["add", "--", str(example_path.resolve())], REPO_ROOT)
    invoke_git([
        "commit",
        "-m",
        "docs(article): attach passing acceptance example",
        "-m",
        f"tag: {tag_name}",
        "-m",
        f"job: {job_id}",
        "-m",
        f"bodyLength: {body_length}",
        "-m",
        f"expectedMin: {expected_min}",
    ], REPO_ROOT)
    invoke_git(["push", "origin", get_git_branch(REPO_ROOT)], REPO_ROOT)
    invoke_git([
        "tag",
        "-a",
        tag_name,
        "-m",
        f"ContentBase acceptance {tag_name}",
        "-m",
        f"Passing HTTP acceptance example: docs/examples/{tag_name}.md",
        "-m",
        f"BodyLength={body_length} LengthExpectedMin={expected_min} JobId={job_id}",
    ], REPO_ROOT)
    invoke_git(["push", "origin", tag_name], REPO_ROOT)
    write_step(f"attached acceptance example docs/examples/{tag_name}.md and pushed tag {tag_name}")
    return tag_name


def format_summary(summary: dict[str, Any]) -> str:
    """把最终摘要格式化成对齐的 key/value 文本。"""

    lines = []
    width = max(len(k) for k in summary)
    for key, value in summary.items():
        lines.append(f"{key:<{width}} : {value}")
    return "\n".join(lines)


def split_docker_image_ref(image: str) -> tuple[str, str | None]:
    """拆分 Docker image 的 repository/tag；digest 引用保持原样。"""

    if "@" in image:
        return image, None
    slash_index = image.rfind("/")
    colon_index = image.rfind(":")
    if colon_index > slash_index:
        return image[:colon_index], image[colon_index + 1:]
    return image, None


def ensure_docker_image_ready(image: str) -> None:
    """确保本地 Docker 预检所需镜像存在，不存在时拉取并输出进度。"""

    try:
        import docker
        import requests.exceptions
        from docker.errors import APIError, DockerException, ImageNotFound
    except ImportError as exc:
        raise RuntimeError("Docker SDK for Python is required for local image preflight; run: pip install docker") from exc
    pull_timeout_sec = int(os.environ.get("CONTENTBASE_DOCKER_PULL_TIMEOUT_SEC", "300"))
    stall_errors = (APIError, DockerException, requests.exceptions.RequestException)
    try:
        client = docker.from_env(timeout=pull_timeout_sec)
        client.ping()
    except DockerException as exc:
        raise RuntimeError(f"Docker Desktop is not reachable; start Docker Desktop and retry: {format_exception_chain(exc)}") from exc
    try:
        client.images.get(image)
        write_step(f"docker image already present: {image}")
        return
    except ImageNotFound:
        pass
    except stall_errors as exc:
        raise RuntimeError(f"failed to inspect docker image {image}: {format_exception_chain(exc)}") from exc
    write_step(f"pulling docker image: {image} (read stalls raise after {pull_timeout_sec}s)")
    try:
        repository, tag = split_docker_image_ref(image)
        last_progress: dict[str, str] = {}
        for event in client.api.pull(repository, tag=tag, stream=True, decode=True):
            error = event.get("error")
            if error:
                raise RuntimeError(str(error))
            layer_id = str(event.get("id") or "image")
            status = str(event.get("status") or "").strip()
            detail = event.get("progressDetail") or {}
            current = detail.get("current")
            total = detail.get("total")
            if isinstance(current, int) and isinstance(total, int) and total > 0:
                percent = int((current / total) * 100)
                marker = f"{status} {percent}%"
            else:
                marker = status
            if marker and last_progress.get(layer_id) != marker:
                last_progress[layer_id] = marker
                print(f"[docker-pull] {image} {layer_id}: {marker}", flush=True)
    except stall_errors as exc:
        raise RuntimeError(f"failed to pull docker image {image}: {format_exception_chain(exc)}") from exc
    write_step(f"docker image pull complete: {image}")


def ensure_docker_stack_ready() -> None:
    """按 CONTENTBASE_REQUIRED_LOCAL_DOCKER_IMAGES 预拉本地依赖镜像。"""

    raw = os.environ.get("CONTENTBASE_REQUIRED_LOCAL_DOCKER_IMAGES", "").strip()
    if not raw:
        return
    for image in [x.strip() for x in raw.split(",") if x.strip()]:
        ensure_docker_image_ready(image)


def preflight_dependency_health() -> None:
    """生产请求前检查 RAGFlow 和 writer pool，避免长任务跑到一半才暴露依赖故障。"""

    if ARGS.skip_preflight:
        write_step("skipping preflight dependency health gate by request")
        return
    ensure_docker_stack_ready()
    database_url = ARGS.database_url.strip().rstrip("/")
    ragflow_url = f"{database_url}/health/ragflow?retrieval=true"
    try:
        ragflow = invoke_json_request("GET", ragflow_url, request_timeout_sec=30)
    except Exception as exc:
        raise RuntimeError(f"preflight: RAGFlow not ready: {exc}") from exc
    ragflow_status = str(get_path(ragflow, "data.status") or get_path(ragflow, "status") or "").lower()
    ragflow_ok = get_path(ragflow, "data.ok")
    if ragflow_ok is None:
        ragflow_ok = get_path(ragflow, "ok")
    ragflow_healthy = get_path(ragflow, "data.healthy")
    if ragflow_healthy is None:
        ragflow_healthy = get_path(ragflow, "healthy")
    if ragflow_status not in ("ok", "healthy") and ragflow_ok is not True and ragflow_healthy is not True:
        raise RuntimeError(f"preflight: RAGFlow not ready: status={ragflow_status or 'unknown'} ok={ragflow_ok} healthy={ragflow_healthy}")

    writer = get_review_model_service("DEEPSEEK", "CONTENTBASE_REVIEW_DEEPSEEK")
    if not writer.get("ok"):
        missing = ", ".join(writer.get("missing") or ["model service not configured"])
        raise RuntimeError(f"preflight: writer pool unavailable: writer service not configured: {missing}")
    probe_body = {
        "model": writer["model"],
        "temperature": 0,
        "max_tokens": 1,
        "messages": [{"role": "user", "content": "ping"}],
    }
    probe_headers = {"Authorization": f"Bearer {writer['apiKey']}", "Accept": "application/json", "Content-Type": "application/json"}
    probe_request = urllib.request.Request(
        f"{writer['baseUrl']}/chat/completions",
        data=json.dumps(probe_body, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers=probe_headers,
    )
    try:
        with urllib.request.urlopen(probe_request, timeout=30) as response:
            response.read()
    except urllib.error.HTTPError as exc:
        payload = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"preflight: writer pool unavailable: HTTP {exc.code} {exc.reason} {payload[:300]}") from exc
    except Exception as exc:
        raise RuntimeError(f"preflight: writer pool unavailable: {format_exception_chain(exc)}") from exc
    write_step("preflight: ragflow=ok writer=ok")


def invoke_http_acceptance() -> None:
    """完整 HTTP 验收主流程：部署、健康检查、生成文章、断言、保存报告。"""

    resolved_base_url = resolve_base_url()
    resolved_topic = resolve_topic()
    source_commit = ""
    if not ARGS.http_only:
        # 非 http-only 模式先收敛到生产 commit，再用生产诊断回读确认。
        ensure_dependencies_deployed()
        invoke_local_checks()
        target_commit = publish_current_repo()
        deploy_contentbase_remote(target_commit)
        ARGS.expected_source_commit = target_commit
        wait_deployment_commit(resolved_base_url, target_commit)

    write_step(f"checking ContentBase HTTP service at {resolved_base_url}")
    health = invoke_json_request("GET", f"{resolved_base_url}/healthz", request_timeout_sec=30)
    if get_path(health, "data.service") != "contentbase":
        raise RuntimeError("healthz did not identify contentbase service")

    write_step("checking diagnostics")
    diagnostics = invoke_json_request("GET", f"{resolved_base_url}/api/corpus/diagnostics", request_timeout_sec=120)
    if not get_path(diagnostics, "data.gateway") and not get_path(diagnostics, "data.generatedAt"):
        raise RuntimeError("diagnostics response is missing expected runtime fields")
    assert_corpus_diagnostics(diagnostics)
    expected_commit = resolve_expected_source_commit()
    source_commit = str(get_path(diagnostics, "data.env.injection.sourceCommit") or "")
    if expected_commit:
        if not source_commit:
            raise RuntimeError("diagnostics response is missing env.injection.sourceCommit")
        if not source_commit.startswith(expected_commit):
            raise RuntimeError(f"sourceCommit mismatch: got {source_commit}, expected prefix {expected_commit}")

    preflight_dependency_health()

    request_body = new_article_request_body(resolved_topic)
    job_id = ""
    if ARGS.sync:
        write_step("posting synchronous article generation request")
        result = invoke_json_request("POST", f"{resolved_base_url}/api/content/runtime/generate/article", body=request_body, request_timeout_sec=ARGS.timeout_sec)
    else:
        # 默认走异步任务路径，避免长文生成超过单次 HTTP 请求窗口。
        write_step("creating async article job")
        created = invoke_json_request("POST", f"{resolved_base_url}/api/content/runtime/generate/article/jobs", body=request_body, request_timeout_sec=120)
        job_id = str(get_path(created, "data.id") or "")
        if not job_id:
            raise RuntimeError("job creation did not return data.id")
        wait_article_job(resolved_base_url, job_id)
        write_step("fetching job result")
        result = invoke_json_request("GET", f"{resolved_base_url}/api/content/runtime/generate/article/jobs/{urllib.parse.quote(job_id, safe='')}/result", request_timeout_sec=180)

    summary = assert_article_result(result, resolved_topic)
    body = get_article_body(result)
    # 下列诊断既用于硬断言，也会写入 Markdown 附录供人工复查。
    storm = get_storm_diagnostics(result)
    assert_storm_diagnostics(storm)
    write_step(format_storm_diagnostics_one_line(storm))
    storm_lines = format_storm_diagnostics(storm)
    recall = get_ragflow_recall(result)
    assert_ragflow_recall(recall)
    write_step(format_ragflow_recall(recall))
    recall_lines = format_ragflow_recall_markdown(recall)
    agent_pipeline = get_agent_pipeline_diagnostics(result)
    agent_lines = format_agent_pipeline_diagnostics(agent_pipeline)
    agent_config_lines = format_agent_config_diagnostics(agent_pipeline)
    post_process = get_post_process_diagnostics(result)
    style_lines = format_style_diagnostics(post_process)
    source_boundary_lines = format_source_boundary_diagnostics(body)
    ending = get_ending_diagnostics(result)
    ending_lines = format_ending_diagnostics(ending)
    length_check = test_article_length(body)
    paragraphs = [x for x in re.split(r"\r?\n\s*\r?\n", body) if x.strip()]
    length_lines = [
        "## 正文长度",
        f"- 是否达到最短要求：{length_check['Ok']}",
        f"- 当前正文字符数：{length_check['BodyLength']}",
        f"- 当前正文段落数：{len(paragraphs)}",
        "- 注意：这里不包含后面的 ContentBase 生成检测、DeepSeek 判断和 Claude 复盘。",
        f"- 最短要求字符数：{length_check['ExpectedMin']}",
        f"- 缺口字符数：{length_check['Missing']}",
    ]
    self_assessment_lines = format_self_quality_assessment(body, post_process, length_check, ending)
    diagnostic_lines_base = [
        "# ContentBase 生成检测",
        "",
        "> 测试复查用，非发布正文。",
        "",
        *storm_lines,
        "",
        *recall_lines,
        "",
        *agent_lines,
        "",
        *agent_config_lines,
        "",
        *style_lines,
        "",
        *source_boundary_lines,
        "",
        *length_lines,
        "",
        *self_assessment_lines,
        "",
        *ending_lines,
    ]
    codex_context_brief_lines = format_codex_project_context_brief(
        resolved_base_url,
        source_commit,
        job_id,
        resolved_topic,
        summary,
        storm,
        recall,
        agent_pipeline,
        post_process,
    )
    external_review_lines = format_external_ai_review_diagnostics(body, diagnostic_lines_base, codex_context_brief_lines)
    saved_path = save_article_body(body, resolved_topic, [*diagnostic_lines_base, "", *external_review_lines])
    if not length_check["Ok"]:
        raise RuntimeError(
            f"article body shorter than requested: {length_check['BodyLength']}, expected at least {length_check['ExpectedMin']}, "
            f"missing {length_check['Missing']}. Saved body: {saved_path}"
        )
    published_tag = ""
    if ARGS.attach_example_and_tag:
        published_tag = publish_acceptance_example_and_tag(saved_path, ARGS.acceptance_tag, job_id or "sync", length_check["BodyLength"], length_check["ExpectedMin"])
    if SOFT_WARNINGS:
        print(f"HTTP acceptance PASS (with {len(SOFT_WARNINGS)} soft warning(s))")
        for w in SOFT_WARNINGS:
            print(f"  ⚠ {w}")
    else:
        print("HTTP acceptance PASS")
    print(format_summary({
        "BaseUrl": resolved_base_url,
        "SourceCommit": source_commit,
        "JobId": job_id or "sync",
        "Topic": summary["Topic"],
        "BodyLength": summary["BodyLength"],
        "Model": summary["Model"],
        "Sources": summary["Sources"],
        "Chunks": summary["Chunks"],
        "Citations": summary["Citations"],
        "AgentBriefChars": summary["AgentBriefChars"],
        "AgentRevisionChars": summary["AgentRevisionChars"],
        "LengthOk": length_check["Ok"],
        "LengthExpectedMin": length_check["ExpectedMin"],
        "LengthMissing": length_check["Missing"],
        "StormStatus": storm.get("status") if storm else "absent",
        "StormPerspectives": storm.get("perspectives") if storm else None,
        "StormQuestions": storm.get("questions") if storm else None,
        "StormCitations": storm.get("citations") if storm else None,
        "RagflowRecallStatus": recall.get("status") if recall else "absent",
        "RagflowRecalledUnits": recall.get("recalledUnits") if recall else None,
        "RagflowPackedUnits": recall.get("packedUnits") if recall else None,
        "SavedPath": saved_path,
        "AcceptanceTag": published_tag,
    }))


def invoke_materials_only_acceptance() -> None:
    """只验收第一阶段资料收集链路，并保存 materials md/json。"""

    resolved_base_url = resolve_base_url()
    resolved_topic = resolve_topic()
    source_commit = ""
    if not ARGS.http_only:
        # materials-only 仍然沿生产部署链路，避免本地路径替代生产验收。
        ensure_dependencies_deployed()
        invoke_local_checks()
        target_commit = publish_current_repo()
        deploy_contentbase_remote(target_commit)
        ARGS.expected_source_commit = target_commit
        wait_deployment_commit(resolved_base_url, target_commit)

    write_step(f"checking ContentBase HTTP service at {resolved_base_url}")
    health = invoke_json_request("GET", f"{resolved_base_url}/healthz", request_timeout_sec=30)
    if get_path(health, "data.service") != "contentbase":
        raise RuntimeError("healthz did not identify contentbase service")

    write_step("checking diagnostics")
    diagnostics = invoke_json_request("GET", f"{resolved_base_url}/api/corpus/diagnostics", request_timeout_sec=120)
    if not get_path(diagnostics, "data.gateway") and not get_path(diagnostics, "data.generatedAt"):
        raise RuntimeError("diagnostics response is missing expected runtime fields")
    assert_corpus_diagnostics(diagnostics)
    expected_commit = resolve_expected_source_commit()
    source_commit = str(get_path(diagnostics, "data.env.injection.sourceCommit") or "")
    if expected_commit:
        if not source_commit:
            raise RuntimeError("diagnostics response is missing env.injection.sourceCommit")
        if not source_commit.startswith(expected_commit):
            raise RuntimeError(f"sourceCommit mismatch: got {source_commit}, expected prefix {expected_commit}")

    request_body = new_article_request_body(resolved_topic)
    write_step("posting materials-only article request")
    result = invoke_json_request("POST", f"{resolved_base_url}/api/content/runtime/generate/article/materials", body=request_body, request_timeout_sec=ARGS.timeout_sec)
    data = get_materials_result(result)
    storm = get_storm_diagnostics(result)
    assert_storm_diagnostics(storm)
    write_step(format_storm_diagnostics_one_line(storm))
    recall = get_ragflow_recall(result)
    assert_ragflow_recall(recall)
    write_step(format_ragflow_recall(recall))
    saved_path = save_materials_result(result, resolved_topic)
    materials = data["materials"]
    print("MATERIALS acceptance PASS")
    print(format_summary({
        "BaseUrl": resolved_base_url,
        "SourceCommit": source_commit,
        "Topic": data.get("topic") or resolved_topic,
        "TargetWordCount": data.get("targetWordCount"),
        "FactNotesChars": len(str(materials.get("factNotes") or "")),
        "WebRealityNotesChars": len(str(materials.get("webRealityNotes") or "")),
        "DivergenceNotesChars": len(str(materials.get("divergenceNotes") or "")),
        "MeaningNotesChars": len(str(materials.get("meaningNotes") or "")),
        "WritingBriefChars": len(str(materials.get("writingBrief") or "")),
        "StormStatus": storm.get("status") if storm else "absent",
        "RagflowRecallStatus": recall.get("status") if recall else "absent",
        "RagflowRecalledUnits": recall.get("recalledUnits") if recall else None,
        "RagflowPackedUnits": recall.get("packedUnits") if recall else None,
        "SavedPath": saved_path,
    }))


def main() -> None:
    """CLI 入口：根据开关分流到 Docker、本地检查、materials-only 或完整验收。"""

    initialize_acceptance_run(parse_args())
    if ARGS.docker_images_only:
        ensure_docker_stack_ready()
        print("docker images PASS")
        return
    if ARGS.local_checks_only:
        invoke_local_checks()
        print("local checks PASS")
        return
    if ARGS.materials_only:
        invoke_materials_only_acceptance()
        return
    invoke_http_acceptance()


if __name__ == "__main__":
    main()
