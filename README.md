# grs-enhance

研究生选课系统脚本——悬浮课表、排队监视、一键切换。

## 安装

### 直接安装

[脚本下载 - Greasy Fork](https://greasyfork.org/zh-CN/scripts/595750-grs-enhance-浙大研究生选课助手)

### 自己复制

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/)
2. 在插件页面，启用"允许用户脚本”扩展设置。
3. 新建脚本,粘贴 `grs-enhance.user.js` 全部内容并保存
4. 打开浙大研究生院选课页面(`yjsy.zju.edu.cn`,菜单"我的课程")自动生效

## 功能

- **悬浮课表**:完整课表悬浮窗,宽高自适应、可拖拽缩放、可折叠成小卡片
- **排队监视**:接口顺序/选课时间顺序位次内联显示在课程"待处理"状态旁,60s 自动刷新、位次变动提示
- **一键切换**:悬停位次徽章,对比同课程各教学班排队情况(教师/校区/余量),一键换班(带确认)

## 说明

排队位次 `POST /dataapi/py/pyXsxk/queryDclXsListByKcbjId?kcbjId=...`

返回大概是：

```
  {
    success: true,
    code: 200,
    result: [
      {
        id: "...",          // 这条选课记录 id
        xsId: "...",        // 学生 id
        kcbjId: "...",      // 教学班 id
        xkzt: "12",         // 待处理
        xkclzt: "12",
        xkzt_dictText: "待处理",
        xkclzt_dictText: "补选待处理",
        kcmc: "中国式现代化的理论与实践",
        bjbh: "3320004014",
        kckId: "...",
        createTime: "2026-09-14 09:05:23",
        xm: "...",
        xh: "...",
        // 还有学院、专业、导师、教师等很多字段
      }
    ]
  }
```

根据用户在这个list当中的返回顺序，和`createTime`升序两个字段显示了两个排序

## License

[MIT](./LICENSE)
