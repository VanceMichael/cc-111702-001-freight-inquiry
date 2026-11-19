# 来源业务约定
当前已运行的业务范围：按给定地址和货物向承运商查询标准报价；承运商在询价中提出条件修正（补填楼层、把地址拆成干线和末端两段、只接受部分货物）时形成待确认线索，采购确认后按来源当前版本成交。
以下约定描述合作源接口及其返回含义，不表示工作台已经办理了所有来源状态。
## `POST /rate`
传入 inquiry、carrier、address、pieces、services；返回 quoteId、revision、accepted、charges、expiresAt。`accepted` 是承运商实际接受的条件，可与请求不同（补填 floor、以 segments 表达干线与末端分段、减少 pieces 等）；响应中的差异不构成用户授权，工作台只按用户事先允许的等价修正自动继续，其余等待采购确认。
## `GET /quote/:id`
读取该报价当前状态；报价变更时 revision 增加。采购确认前与恢复未完询价时，工作台重新读取报价，按返回的 revision、条件与费用更新本地记录；已有确认只对原 revision 与原条件有效，来源重新计价或改变条件后需再次确认。
## `POST /confirmations`
传入 inquiry、quoteId、seenQuoteRevision、accepted；seenQuoteRevision 为工作台确认时看到的报价版本。返回 confirmationId、accepted、seenQuoteRevision；来源未接纳或版本不符时确认不成立。
## 费用领取
`charges` 中项目可携带 `ref`（本地路径）代替 `amount`，工作台以 GET 该路径领取 `{kind, amount}`。必收费用领取失败时报价不完整，不按零元处理，修复后可经刷新重新领取。
## 本地传输
本地来源按请求方法和路径匹配，查询和正文不参与路由匹配。响应脚本只负责返回来源原始数据，不替工作台判断业务是否完成。`delayMs` 为本次响应延迟，`disconnect` 表示未返回确定响应便断开连接，`status` 为 HTTP 状态；记录顺序与实际请求一致。来源实例独享响应进度，重新启动恢复第一条。
业务标识区分大小写；金额为最小货币单位的整数，时间为本地来源统一的整数秒。样例中的身份、合同和公司均为合成资料，不是外部系统账号。

## 本地可读资源
`GET /quote/Q-1` 返回该资源的合成业务资料；正常样例中的身份与主领取记录一致。
`POST /confirmations` 返回该资源的合成业务资料；正常样例中的身份与主领取记录一致。

来源路径可包含具名段，按段匹配。`requireBody` 与 `requireQuery` 可限制业务范围，不符合时返回409且不推进响应序列；`requireAuthentication` 表示该路由要求授权。`GET /counters` 只返回来源处理次数，不参与收件决策。
