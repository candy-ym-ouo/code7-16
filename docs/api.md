# API 约定

基础路径：`/api/v1`。

- JSON 请求由 Zod 校验。
- 认证使用 `Authorization: Bearer <token>`。
- 刷新令牌使用 HttpOnly Cookie；刷新请求需要 `X-CSRF-Token`。
- 错误返回类似 RFC 9457 的结构，并包含 `code`、`detail` 和 `requestId`。
- 地图查询必须传 `bbox=minLon,minLat,maxLon,maxLat`，单次跨度限制为 5 度。

## 公开接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/categories` | 分类与详情 schema |
| `GET` | `/features?bbox=...` | 查询已发布地图要素 |
| `GET` | `/features/:id` | 已发布详情；作者和审核员可查看私有状态 |
| `GET` | `/features/:id/comments` | 已发布评论 |
| `GET` | `/features/:id/confirmations` | 时效确认汇总 |
| `GET` | `/accessibility/nodes?bbox=...` | 查询有效无障碍通行节点 |
| `GET` | `/accessibility/edges?bbox=...` | 查询坡道、电梯、路面等通行边 |
| `GET` | `/accessibility/routes/shortest?from=...&to=...` | 约束最短路；不可达时返回阻断解释 |
| `GET` | `/health/live` | 进程存活 |
| `GET` | `/health/ready` | 数据库就绪 |

### 无障碍通行链查询

`from`、`to` 均为 `accessibility_nodes.id`。默认使用 `profile=wheelchair`、`objective=distance`，轮椅默认坡度上限 8.33%、净宽下限 800mm、台阶上限 0mm，并避开楼梯。

可用查询参数：

- `profile=wheelchair|walk`
- `objective=distance|accessibility`
- `maxSlopePercent`、`minClearWidthMm`、`maxStepHeightMm`
- `requireElevator=true`、`requireRamp=true`、`avoidStairs=true`
- `requireOperational=true`：关闭、维护或状态未知的节点/边不参与通行
- `allowedSurfaces=concrete,asphalt` 或 `allowUnknownSurface=true`

可达时返回 `reachable=true`、节点序列、边序列、实际距离 `distanceM` 和用于最短路比较的 `cost`。不可达时返回：

- `endpoint_missing`：起终点不在有效图中；
- `endpoint_unavailable`：起点或终点自身不满足约束；
- `graph_disconnected`：不考虑约束也没有图路径；
- `constraints_not_satisfied`：存在普通图路径但无满足约束的路径，`blockers` 给出坡度、净宽、台阶、路面、楼梯、关闭/维护等阻断点。

响应带 `graphVersion`。图节点和边的创建、更新、软删除在数据库事务中提升 `accessibility_graph_meta.version`；查询在 `REPEATABLE READ` 中读取版本和图数据，Redis 只按不可变版本缓存快照。更新提交后的新查询不会读取旧版本缓存。

## 账号接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/auth/register` | 注册并加入验证邮件 outbox |
| `POST` | `/auth/verify-email` | 邮箱验证 |
| `POST` | `/auth/login` | 登录并建立刷新会话 |
| `POST` | `/auth/refresh` | 轮换刷新令牌 |
| `POST` | `/auth/logout` | 撤销会话 |
| `POST` | `/auth/password/forgot` | 发送重置邮件 |
| `POST` | `/auth/password/reset` | 重置密码 |
| `GET` | `/me` | 当前用户 |
| `PATCH` | `/me` | 修改昵称 |
| `POST` | `/me/export` | 导出账号数据 |
| `POST` | `/me/delete` | 申请删除账号 |

## 投稿接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/features` | 创建草稿 |
| `PATCH` | `/features/:id/draft` | 更新草稿或被拒内容 |
| `POST` | `/features/:id/submit` | 提交最新草稿 |
| `POST` | `/features/:id/revisions` | 为已发布内容创建修订 |
| `POST` | `/features/:id/revisions/:revisionId/submit` | 提交修订 |
| `GET` | `/features/:id/revisions` | 作者/审核员查看历史 |
| `GET` | `/me/features` | 我的投稿 |
| `DELETE` | `/features/:id` | 软删除 |
| `POST` | `/features/:id/confirmations` | 记录时效确认 |

## 媒体接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/media/uploads` | 创建隔离区签名上传 |
| `POST` | `/media/uploads/:id/complete` | 提交隐私框并启动服务端处理 |
| `GET` | `/media/:id` | 查询处理状态 |
| `GET` | `/media/:id/preview` | 审核员获取短期私有预览 |
| `POST` | `/media/:id/privacy-approve` | 审核员确认隐私并发布派生图 |
| `POST` | `/media/:id/retry` | 重试失败处理 |
| `DELETE` | `/media/:id` | 删除媒体对象 |

## 评论、举报和通知

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/features/:id/comments` | 创建待审核评论 |
| `PATCH` | `/comments/:id` | 15 分钟编辑窗口 |
| `DELETE` | `/comments/:id` | 删除评论 |
| `POST` | `/reports` | 举报内容或评论 |
| `GET` | `/me/notifications` | 通知列表 |
| `POST` | `/me/notifications/:id/read` | 标记已读 |

## 审核接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/moderation/queue` | 内容、评论、媒体和举报队列 |
| `POST` | `/moderation/features/:id/approve` | 批准内容或修订 |
| `POST` | `/moderation/features/:id/reject` | 拒绝 |
| `POST` | `/moderation/features/:id/request-changes` | 要求修改 |
| `POST` | `/moderation/features/:id/hide` | 隐藏 |
| `POST` | `/moderation/features/:id/restore` | 管理员恢复 |
| `POST` | `/moderation/comments/:id/approve` | 批准评论 |
| `POST` | `/moderation/comments/:id/reject` | 拒绝评论 |
| `POST` | `/moderation/comments/:id/hide` | 隐藏评论 |
| `POST` | `/moderation/reports/:id/resolve` | 处理举报 |
| `POST` | `/moderation/accessibility/nodes` | 创建通行地点 |
| `PATCH` | `/moderation/accessibility/nodes/:id` | 更新通行地点并提升图版本 |
| `DELETE` | `/moderation/accessibility/nodes/:id` | 软删除无活动边引用的通行地点 |
| `POST` | `/moderation/accessibility/edges` | 创建坡道、电梯、路面通行边 |
| `PATCH` | `/moderation/accessibility/edges/:id` | 更新通行属性并提升图版本 |
| `DELETE` | `/moderation/accessibility/edges/:id` | 软删除通行边 |
| `GET` | `/moderation/audit` | 管理员审计日志 |
