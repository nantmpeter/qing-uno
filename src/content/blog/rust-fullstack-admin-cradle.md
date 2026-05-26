---
title: "从零构建 Rust 全栈后台： Cradle 项目复盘"
description: "8 个阶段，61 个集成测试，记录一个 Rust 全栈后台框架从想法到落地的完整过程，以及踩过的那些坑。"
pubDate: 2026-05-27
tags: ["Rust", "Axum", "React", "全栈", "后台框架"]
category: "技术"
draft: false
lang: "zh"
tldr: "大多数后台管理系统在一年内会经历重写，根因是起点没有架构记忆。Rust 在 AI 加持下门槛大降，Cradle 从第一天起就在设计里埋好了三层 API、RBAC、数据权限、Webhook。"
keywords: ["Rust", "Axum", "React", "全栈开发", "后台管理系统", "PostgreSQL"]
readingTime: "12 min"
---

## 背景：为什么好用的后台框架这么少

团队维护过太多后台管理系统。大多数项目在早期都遵循同样的轨迹：

1. 快速搭一个管理后台，上线
2. 需求来了，加字段、加接口、加权限
3. 一年后，代码变成一锅粥，没人敢动核心模块
4. 老板说「加个移动端」，原来的架构根本接不住
5. 重写

每次重写的根因都一样：起点没有「架构记忆」。团队用 Node.js/Python 搭过太多管理后台，null dereference、并发 race condition、密码明文存储、RBAC 和业务逻辑耦合……这些问题第一次出现时解决得很轻松，但每次出现都在消耗相同的精力。

**现状的转变**：Rust 曾经是「门槛高、来不及用」的选择——所有权模型、编译时长、生态不如 Node.js 成熟。但在 AI 辅助编程的加持下，这个障碍已经大大降低。AI 可以帮你写 Rust 代码、补全错误信息、解释编译报错。Rust 从「需要系统性学习才能用」变成了「可以边用边学」。

Cradle 的目标：用 Rust 做后端，从第一天起就不会在架构上踩常见坑。三层 API、RBAC、数据权限、事件驱动 Webhook —— 不是后续迭代时加上去的，是第一天就在设计里的。

---

## 技术选型：Rust + React 的组合

### 后端：Rust + Axum

| 技术 | 选择理由 |
|------|----------|
| Axum 0.8 | 异步 HTTP 框架，社区活跃，中间件设计清晰 |
| SQLx | 编译期检查 SQL，纯异步，性能优秀 |
| PostgreSQL 16 | JSON/JSONB 支持好，数组类型适合 RBAC |
| JWT (access + refresh) | 标准做法，双 token 做分离 |
| TOTP (totp-rs) | 2FA，迁移成本低 |

Rust 的核心收益不是「快」，而是**约束**。没有 GC，没有 null，编译时 refus to compile 掉大多数 production bug。第一次在管理后台项目里敢说「单元测试覆盖」而不只是说说。

### 前端：React 19 + shadcn/ui

| 技术 | 选择理由 |
|------|----------|
| React 19 + Vite | 快，HMR 体验好 |
| shadcn/ui | 不是组件库，是设计系统的代码来源，按需引入 |
| Tailwind CSS v4 | Utility-first，配合 shadcn 非常顺 |
| TanStack Query v5 | Server state 管理，数据同步、缓存、轮询开箱即用 |
| Zustand | Client state（auth），轻量够用 |

---

## Phase 1：用户管理 — 最小可工作系统

目标是搭一个能跑起来的骨架，不要想太多。

**后端**只做了：用户 CRUD + JWT 登录。三个文件起家：`lib.rs`、`auth_handler.rs`、`user_repo.rs`。这阶段踩了第一个坑：

```rust
// 错误：password 在 DTO 里直接返回
#[derive(Serialize)]
struct UserDto {
    password: String, // ← 生产级别事故
}

// 正确：明确排除敏感字段
#[derive(Serialize)]
struct UserDto {
    // password intentionally excluded
    id: Uuid,
    email: String,
}
```

**前端**只做了：登录页 + 用户列表。路由守卫 + TanStack Query 拿数据。

**这阶段最重要的决定**：项目目录结构固定下来。每个 Phase 的结构遵循同一套路径约定，这是后续所有模块自动化的前提。

---

## Phase 2：RBAC — 权限模型的设计陷阱

RBAC 听起来简单，做起来到处都是陷阱。

### 权限模型设计

最朴素的想法是「角色有权限列表」。但实际业务里：

- **超管（superadmin）**：绕过所有权限检查
- **部门管理员**：只能管本部门的人
- **数据权限**：不只是「能看」，还要「只能看到自己部门的」

最终设计：

```
roles:
  - id, name, slug, description, is_superadmin, data_scope
  - data_scope ∈ { all, department, department_and_sub, self }

permissions:
  - id, code, name, resource, action
  - 格式：resource:action (e.g., user:read, user:write)

role_permissions:
  - role_id, permission_id

user_roles:
  - user_id, role_id
```

`data_scope` 字段是后来 Phase 7 才真正用上的设计，但结构已经埋进去了。

### 中间件的坑

Axum 的中间件系统是这次踩过最深的坑。

```rust
// 错误：把中间件写成独立层，想当然地套到所有路由上
// 然后发现某些路由需要绕过 auth
Router::new()
    .layer(auth_layer) // ← 全局 auth，超管也被拦了
```

```rust
// 正确：auth 中间件只在需要的地方显式挂载
// 超管权限在 service 层判断，不在中间件层拦截
Router::new()
    .nest("/admin", authProtectedRoutes()) // 只在这里加 auth
```

**这阶段最重要的决定**：auth 中间件和 RBAC 判断分离。中间件只负责「从 token 里提取用户」，权限判断交给 handler/service 层。

---

## Phase 3：Dashboard — 数据聚合查询

Dashboard 的核心是「一个页面里同时查多个不相关的聚合」。

```rust
pub async fn dashboard_stats(...) -> Json<DashboardStats> {
    let (user_count, role_count, active_sessions, recent_logs) =
        tokio::join!(
            user_repo::count(&pool),
            role_repo::count(&pool),
            session_repo::active_count(&pool),
            audit_repo::recent(&pool, 10),
        );
    // ...
}
```

`tokio::join!` 并行四个独立 SQL 请求，响应时间从四个串行请求的 Sum 变成 Max。

---

## Phase 4：文件上传 / 导出 / 会话管理 / 动态菜单 / i18n

这阶段没有新架构决策，都是工程实现。但有几个值得记录的细节：

### 文件上传：S3 兼容性设计

最初文件存在本地 `./uploads/`。但 PRD 明确要求「后续支持 S3」。于是抽象了一层：

```rust
#[enum_dispatch]
trait StorageBackend {
    async fn upload(&self, key: &str, data: Bytes) -> Result<String>;
    async fn download(&self, key: &str) -> Result<Bytes>;
}

// 本地实现和 S3 实现都 implement StorageBackend
// 配置里切换 backend = "local" | "s3"
```

这在 Phase 8 的 Webhook 设计里再次出现。

### 动态菜单

菜单从数据库读，按用户角色过滤。前端拿到菜单树后直接渲染 sidebar，不需要重新发版就能调整导航结构。

### i18n

用 i18next，两套 JSON 文件（zh-CN/en-US）。后端所有错误消息用 `error.rs` 里的统一格式，前端按 key 查。

---

## Phase 5：2FA / 通知 / 审计日志增强 / 系统配置

### TOTP 2FA 的坑

用的是 `totp-rs` crate。Phase 4 写的时候用的是 v4 API，Phase 5 升级后发现 breaking change。

```rust
// v4
Secret::new(issuer, account_name, secret)
// v5 (with otpauth feature)
TOTP::new(algorithm, digits, skew, step, secret, issuer, account_name)
```

而且 v5 需要启用 `gen_secret` feature 才能用 `Secret::generate_secret()`。

**教训**：Rust crate 升级一定要看 CHANGELOG，不要只看 docs.rs 的最新版本。

### 审计日志：变更内容怎么记

```rust
// 增量记录：只记变更的部分
let changes = AuditChangeBuilder::new()
    .compare("status", old.status, new.status)
    .compare("role_ids", old.roles, new.roles)
    .build();
// changes = [{"field": "status", "from": "active", "to": "inactive"}, ...]
```

---

## Phase 6：部门管理 / 字典管理 / 登录日志 / 用户导入

### 树形部门数据的设计

部门有上下级关系。Cradle 用邻接表 + 递归 CTE：

```sql
WITH RECURSIVE dept_tree AS (
    SELECT id, name, parent_id, 0 as depth
    FROM departments
    WHERE id = $1
    UNION ALL
    SELECT d.id, d.name, d.parent_id, dt.depth + 1
    FROM departments d
    JOIN dept_tree dt ON d.parent_id = dt.id
)
SELECT * FROM dept_tree ORDER BY depth;
```

### 用户导入：Excel 解析

用 `calamine` 读 Excel，批量插入。API 在 0.25→0.26 有 breaking change，`open_workbook_from_rs(ReaderType::Xlsx, cursor)` 变成了 `open_workbook_auto_from_rs(cursor)`。

---

## Phase 7：全局搜索 / 数据权限 / SSE / 头像 / 面包屑 / Tabs / 主题

数据权限是这阶段最核心的设计。

### 数据权限架构

```
roles.data_scope:
  - all:           看所有数据
  - department:    只看本部门
  - department_and_sub: 看本部门及下级部门
  - self:          只看自己（仅超级管理员）
```

AuthUser 在提取出来后计算一次 `visible_department_ids`，然后注入到 `ListParams` 里，handler 层的 query 带上这个过滤条件。所有 list API 统一走这个路径。

### SSE 实现

1. 浏览器 `EventSource` 不支持自定义 Header，所以 SSE 端点用 query param 传 token
2. Handler 层解析 query param，手动验证 JWT
3. `AppState` 里持有一个 `broadcast::Sender<SseNotification>`，所有 handler 都可以往里发消息

```rust
// AppState
pub struct AppState {
    pub notification_tx: broadcast::Sender<SseNotification>,
    // ...
}

// handler 触发事件
notification_tx.send(SseNotification::UserLogin { user_id })?;
```

### 主题定制

8 种 accent color 可选。每种颜色生成 10 个梯度，用 CSS 变量存储。Tailwind CSS v4 的 `@theme` 指令让自定义颜色变得异常顺滑。

---

## Phase 8：三层 API 架构 — 最后一公里的设计

这是整个框架最关键的一步。前 7 个 Phase 建的是「管理后台」，Phase 8 要让它变成「平台」。

### 三层路由设计

| 层 | 前缀 | 认证方式 | 场景 |
|---|------|----------|------|
| Admin | `/api/v1/admin/*` | JWT + RBAC | 管理后台 |
| App | `/api/v1/app/*` | JWT + client_type | 移动端/小程序 |
| Open | `/api/v1/open/*` | API Key + Scope | 第三方集成 |

关键设计：**三层路由复用同一套 repository/service/handler**，只是在 access layer 做了认证分离。

### API Key 格式

```
rk_{base64url(32 random bytes)}
```

SHA-256 哈希存储在数据库，前 8 位用于展示识别。支持 scopes：`users:read`, `users:write`, `departments:read`...

### Webhook 投递

事件在 handler 层触发，不侵入 service 签名：

```rust
// handler 层
webhook_service::emit(&state, WebhookEvent::UserCreated { user_id }).await?;
```

投递架构：mpsc channel → dedicated event worker → HMAC-SHA256 签名 → tokio::spawn 异步 POST。失败重试：60s / 300s / 1800s 指数退避。

---

## 测试：怎么保证不摔坏已有功能

Phase 8 最大的工程挑战：61 个集成测试覆盖全 API。每加一个 Phase 都要确保之前的功能不被破坏。

### 测试基础设施

共享数据库 + `create_test_app()` 模板。每个测试函数开头重置超管状态：

```rust
async fn create_test_app() -> TestApp {
    let app = spawn_app().await;
    // reset admin 2fa state to avoid test pollution
    sqlx::query("UPDATE users SET two_factor_enabled = false, locked_until = NULL, login_failures = 0 WHERE email = 'admin@example.com'")
        .execute(&app.db_pool).await.unwrap();
    app
}
```

### 并发测试的坑

多个测试并发执行时，admin 账号会被其中一个测试锁定，导致后续测试的登录用例全部失败。解法：所有写 admin 账号状态的测试，都先执行 reset query。

---

## 落地后学到的几件事

### 1. 架构是减法，不是加法

8 个 Phase，每一阶段结束时都在想「要不要加这个东西」。最终保留的功能都是「不加就会导致重复工作」的，而不是「看起来很厉害但没人用」的。

### 2. Rust 的约束是礼物，不是障碍

团队第一次写出「这段代码在 Node.js 里肯定内存泄漏，但现在 Rust 编译器帮我抓到了」的时刻——这才是 Rust 在后台项目里的真正价值。不是性能，是可信度。

### 3. 三层 API 不是过度设计

Phase 1-7 只做管理后台时，觉得三层 API 是浪费。Phase 8 做移动端接入时才发现：三层分离让新 client 的接入成本从「理解整个系统」变成「选一个层，读对应文档」。

### 4. 测试是文档，不是负担

61 个集成测试，每一个都是一个可运行的 API 示例。新来的开发者想知道「创建用户用什么格式」，看测试比看文档更准确。

---

## 技术栈一览

| Layer | Technology |
|-------|-----------|
| Backend | Rust · Axum 0.8 · SQLx 0.8 · PostgreSQL 16 |
| Frontend | React 19 · TypeScript 6 · Vite 6 · shadcn/ui · Tailwind CSS v4 |
| State | Zustand · TanStack Query v5 |
| Auth | JWT (access + refresh) · Argon2 · TOTP 2FA · API Key · OAuth2 |
| Build | Cargo Workspace · Turborepo |
| API Docs | utoipa@5 · swagger-ui@8 |
| Testing | cargo test (61 integration tests) |

---

**项目地址**：[https://github.com/nantmpeter/cradle](https://github.com/nantmpeter/cradle)