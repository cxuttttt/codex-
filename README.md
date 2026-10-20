# Tidewater 安卓验证版

将 [dgreenheck/tidewater](https://github.com/dgreenheck/tidewater) 的完整海岛场景封装为 Android APK。
原项目固定在提交 4811ba48d795197de5621985f404e765c0b7c0ef。

## 当前范围

- Android 12 及以上，使用系统 WebView 的 WebGPU。
- 横屏全屏，左侧移动摇杆、拖动画面转向、多指触控。
- 支持互动、鱼竿、抛竿 / 收线、跳跃 / 上浮、下潜、加速、背包。
- 保留原项目的场景、海水、天气、生态与游戏逻辑。
- APK 内置完整模型、贴图、音效；使用本地 HTTPS 资源加载，不申请联网权限。
- 运行前进行 GPU 计算读取检查；运行时可复制设备信息、GPU 能力、错误和前台帧率样本。
- 提供 50%、70%、100% 渲染精细度选择。默认 70%，效果系统保留。
- 游戏原有本地存档继续使用。切换后台会清除输入、保存进度并暂停渲染。

## 安装与验证

从 Actions 的最新成功构建下载 tidewater-android-verification，解压后安装 Tidewater.apk。
这是带调试签名的验证版，不是应用商店发布版。
首次进入可能需要较长时间编译着色器。保持前台，完成后点击进入场景。

推荐依次测试：

1. 启动后能否看到完整场景；运行诊断中的 GPU 检查是否通过。
2. 左摇杆与右侧转向、按键能否同时使用，松手后是否停止。
3. 步行、海边、开船、水下和夜间是否存在图形错误。
4. 进入背包、交易界面、切后台后恢复，操作是否正常。
5. 持续运行约 10 分钟后复制诊断，检查帧率和错误。
6. 断网重新启动，确认完整资源仍能加载。

GitHub 构建只验证代码、资源、安卓编译和静态检查，无法证明真实手机上的帧率、发热或 GPU 驱动兼容性。
用户清除应用数据或卸载应用会移除本地存档。

## 云端构建

Actions 自动下载上游、应用本仓库的 mobile 适配文件、运行输入回归检查和原项目游戏逻辑测试，
使用 Vite 构建完整游戏，再通过 Android Gradle Plugin 生成 APK。
构建过程逐个核对原始 public 资源，并再次核对 APK 内的全部原始资源 SHA256。

本仓库不重复存储第三方资源；完整第三方许可证随 APK 放入 assets/game/licenses 和原资源目录。

## 本机构建

需要 Node.js 22.12+、Git、Java 17、Gradle 8.11.1 和 Android SDK 35。

    node scripts/prepare-upstream.mjs
    cd upstream
    npm ci
    cd ..
    node scripts/check-mobile.mjs
    node scripts/bundle.mjs
    cd android
    gradle assembleDebug lintDebug

构建结果：android/app/build/outputs/apk/debug/app-debug.apk

## 许可证

本仓库新增的适配代码采用 MIT 许可证。
原项目代码及第三方素材保持各自许可证，详见上游 LICENSE 和 CREDITS.md。
