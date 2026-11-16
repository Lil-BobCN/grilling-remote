# 功能地图

顾客打开首页，看今天能订的货和取货时段，填手机号下单，拿到取货时间。

| 功能 | 顾客从哪进 | 代码在哪 |
| --- | --- | --- |
| 今日货品 | 首页 `/` | `src/features/catalog/` |
| 取货时段和剩余名额 | 首页 `/` 的下拉框 | `src/features/catalog/`、`src/features/orders/` |
| 下单 | 首页表单，提交到 `POST /orders` | `src/features/orders/` |
| 确认页 | 下单后跳到 `/orders/<编号>` | `src/features/pages/` |

## 更新规则

每张改到顾客可见行为的票，合并前更新这张表。新功能加一行，删掉的功能删一行。只改内部实现、顾客看不到的票不用改。
