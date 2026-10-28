package xyz.cpyh.dshpush

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.ImageFormat
import android.graphics.SurfaceTexture
import android.graphics.drawable.GradientDrawable
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.params.StreamConfigurationMap
import android.media.ImageReader
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.util.Size
import android.view.Gravity
import android.view.Surface
import android.view.TextureView
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 扫码配对（v1.33.53）——对着插件设置页那张二维码扫一下，把「推送通行证 + 网页入口」一次收下。
 *
 * 为什么自己写 Camera2 而不用现成的扫码库：
 *  - `zxing-android-embedded` 依赖 androidx.appcompat，而本 App 至今没有任何 androidx 依赖，
 *    为扫个码把整条 androidx 链拉进来不值（APK 变胖、主题还要跟它打架）。
 *  - `com.google.zxing:core` 是纯 Java（600 KB，无 Android 依赖），相机与预览自己写几十行就够。
 *
 * 流程：TextureView 预览 → ImageReader(YUV_420_888) 取帧 → 后台线程转成 PlanarYUVLuminanceSource
 * → MultiFormatReader（只开 QR_CODE）→ 命中就 [PushService.parsePass] 校验 → 回传原始字符串给
 * MainActivity 落盘。**校验放在这里**，扫到不相干的二维码时给一句人话，而不是把乱七八糟的东西
 * 塞进通行证框。
 *
 * 结果：`setResult(RESULT_OK, Intent().putExtra(EXTRA_PASS, 原始载荷))`。
 */
class ScanPairActivity : Activity() {

    companion object {
        const val EXTRA_PASS = "pass"
        private const val REQ_CAMERA = 21
    }

    private lateinit var preview: TextureView
    private lateinit var hint: TextView
    private lateinit var root: FrameLayout

    private var thread: HandlerThread? = null
    private var handler: Handler? = null
    private var camera: CameraDevice? = null
    private var session: CameraCaptureSession? = null
    private var imageReader: ImageReader? = null
    private var previewSize: Size = Size(1280, 720)

    /** 命中一次就停：解码是后台线程，连拍几帧会重复回调。 */
    private val done = AtomicBoolean(false)
    private var decoding = AtomicBoolean(false)

    private val qrReader = MultiFormatReader().apply {
        setHints(
            mapOf(
                DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE),
                DecodeHintType.TRY_HARDER to true,
            )
        )
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        preview = TextureView(this)
        root.addView(preview, FrameLayout.LayoutParams(-1, -1))

        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(20), dp(28), dp(20), dp(20))
            // v1.33.53：预览画面亮的时候白色标题会整个消失（实测泛白场景只剩一行灰提示），
            // 所以给顶部文字垫一层自上而下的半透明黑底。
            background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(0xC0000000.toInt(), 0x00000000),
            )
        }
        bar.addView(TextView(this).apply {
            text = "扫码配对"
            setTextColor(Color.WHITE)
            textSize = 19f
        })
        hint = TextView(this).apply {
            text = "把手机对准插件设置页里的二维码"
            setTextColor(0xFFB9C6D6.toInt())
            textSize = 13f
            setPadding(0, dp(6), 0, 0)
        }
        bar.addView(hint)
        root.addView(bar, FrameLayout.LayoutParams(-1, -2, Gravity.TOP))
        setContentView(root)

        preview.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
            override fun onSurfaceTextureAvailable(st: SurfaceTexture, w: Int, h: Int) = open()
            override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, w: Int, h: Int) = Unit
            override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
                close()
                return true
            }
            override fun onSurfaceTextureUpdated(st: SurfaceTexture) = Unit
        }
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun open() {
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.CAMERA), REQ_CAMERA)
            return
        }
        // v1.33.53：相机枚举与 openCamera 全是 binder 调用，慢机型/模拟器上能卡 5s+。
        // 2026-10-28 实测：放在主线程直接从 onSurfaceTextureAvailable 里同步跑会
        // ANR（Input dispatching timed out，Waited 5013ms for FocusEvent）。
        // 所以线程先建好，侦察与打开全部丢到后台线程，主线程只做权限判断与 view 操作。
        if (thread == null) {
            thread = HandlerThread("scan").also { it.start() }
            handler = Handler(thread!!.looper)
        }
        handler?.post { openBack() }
    }

    private fun openBack() {
        val manager = getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val id = manager.cameraIdList.firstOrNull { camId ->
            val ch = manager.getCameraCharacteristics(camId)
            ch.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK
        } ?: manager.cameraIdList.firstOrNull() ?: run {
            fail("这台设备没有可用相机")
            return
        }
        val ch = manager.getCameraCharacteristics(id)
        val map = ch.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP) as StreamConfigurationMap
        // 取 1280×720 级别：够 zxing 解 57 模块的码，又不至于每帧都太慢。
        previewSize = map.getOutputSizes(ImageFormat.YUV_420_888)
            ?.filter { it.width <= 1920 && it.height <= 1080 }
            ?.minByOrNull { kotlin.math.abs(it.width - 1280) + kotlin.math.abs(it.height - 720) }
            ?: Size(1280, 720)

        if (handler == null) {
            thread = HandlerThread("scan").also { it.start() }
            handler = Handler(thread!!.looper)
        }
        imageReader = ImageReader.newInstance(previewSize.width, previewSize.height, ImageFormat.YUV_420_888, 2)
        imageReader!!.setOnImageAvailableListener({ r -> onFrame(r) }, handler)

        @Suppress("MissingPermission")
        manager.openCamera(id, object : CameraDevice.StateCallback() {
            override fun onOpened(dev: CameraDevice) {
                camera = dev
                startPreview()
            }

            override fun onDisconnected(dev: CameraDevice) {
                dev.close()
                camera = null
            }

            override fun onError(dev: CameraDevice, error: Int) {
                dev.close()
                camera = null
                if (!done.get()) fail("相机打不开（" + error + "）")
            }
        }, handler)
    }

    private fun startPreview() {
        val dev = camera ?: return
        val st = preview.surfaceTexture ?: return
        st.setDefaultBufferSize(previewSize.width, previewSize.height)
        val surface = Surface(st)
        val req = dev.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply {
            addTarget(surface)
            addTarget(imageReader!!.surface)
            set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)
        }
        dev.createCaptureSession(
            listOf(surface, imageReader!!.surface),
            object : CameraCaptureSession.StateCallback() {
                override fun onConfigured(s: CameraCaptureSession) {
                    session = s
                    runCatching { s.setRepeatingRequest(req.build(), null, handler) }
                }

                override fun onConfigureFailed(s: CameraCaptureSession) = fail("预览配置失败")
            },
            handler,
        )
        // 有的机型 AF 会一直拉风箱、对不准近处的屏幕，扫不出就退到固定焦距。
        handler?.postDelayed({
            if (done.get()) return@postDelayed
            runCatching {
                val dev2 = camera ?: return@postDelayed
                val s2 = session ?: return@postDelayed
                val st2 = preview.surfaceTexture ?: return@postDelayed
                val surf = Surface(st2)
                val req2 = dev2.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply {
                    addTarget(surf)
                    addTarget(imageReader!!.surface)
                    set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_OFF)
                    set(CaptureRequest.LENS_FOCUS_DISTANCE, 0.2f)
                }
                s2.setRepeatingRequest(req2.build(), null, handler)
            }
        }, 3500)
    }

    /** 取一帧 → 灰度 → 交给 zxing。解码在后台线程，不阻塞相机回调。 */
    private fun onFrame(r: ImageReader) {
        if (done.get() || decoding.getAndSet(true)) {
            r.acquireLatestImage()?.close()
            return
        }
        val image = runCatching { r.acquireLatestImage() }.getOrNull()
        if (image == null) {
            decoding.set(false)
            return
        }
        try {
            val w = image.width
            val h = image.height
            val plane = image.planes[0]
            val buffer = plane.buffer
            val rowStride = plane.rowStride
            val pixelStride = plane.pixelStride
            val data = ByteArray(w * h)
            if (pixelStride == 1 && rowStride == w) {
                buffer.get(data, 0, minOf(buffer.remaining(), data.size))
            } else {
                // YUV_420_888 的 Y 面常常带行内边距（rowStride > width），逐行拷。
                val row = ByteArray(rowStride)
                var out = 0
                for (y in 0 until h) {
                    val n = minOf(rowStride, buffer.remaining())
                    if (n <= 0) break
                    buffer.get(row, 0, n)
                    val take = minOf(w, n)
                    System.arraycopy(row, 0, data, out, take)
                    out += take
                }
            }
            val source = PlanarYUVLuminanceSource(data, w, h, 0, 0, w, h, false)
            val result = runCatching { qrReader.decodeWithState(BinaryBitmap(HybridBinarizer(source))) }.getOrNull()
            if (result != null) hit(result.text)
        } catch (e: Exception) {
            // 单帧失败很正常（对焦中、运动模糊），下一帧再来。
        } finally {
            image.close()
            decoding.set(false)
        }
    }

    private fun hit(text: String) {
        if (!done.compareAndSet(false, true)) return
        val (cfg, error) = PushService.parsePass(text)
        if (cfg == null) {
            handler?.post {
                done.set(false)
                hint.text = error.ifEmpty { "这不是配对二维码，再试一次" }
            }
            return
        }
        setResult(RESULT_OK, Intent().putExtra(EXTRA_PASS, text))
        finish()
    }

    private fun fail(message: String) {
        if (done.getAndSet(true)) return
        runOnUiThread {
            hint.text = message
            hint.setTextColor(0xFFFF9C9C.toInt())
        }
        handler?.postDelayed({ finish() }, 1600)
    }

    override fun onRequestPermissionsResult(code: Int, perms: Array<out String>, res: IntArray) {
        if (code != REQ_CAMERA) return
        if (res.isNotEmpty() && res[0] == PackageManager.PERMISSION_GRANTED) {
            open()
        } else {
            Toast.makeText(this, "没有相机权限就扫不了码；也可以在通行证框里手工粘贴", Toast.LENGTH_LONG).show()
            finish()
        }
    }

    private fun close() {
        runCatching { session?.close() }
        session = null
        runCatching { camera?.close() }
        camera = null
        runCatching { imageReader?.close() }
        imageReader = null
        thread?.quitSafely()
        thread = null
        handler = null
    }

    override fun onDestroy() {
        done.set(true)
        close()
        super.onDestroy()
    }
}
