from pathlib import Path
from PIL import Image
from rembg import remove, new_session
import numpy as np
from scipy import ndimage

SRC = Path("C:/Users/Administrator/Downloads/AI网页版链接 (1).png")
OUT = Path("C:/Users/Administrator/WorkBuddy/2026-07-28-02-08-39/workbench/assets/sakura.png")

# 1. 用 anime 模型抠图
print("remove with isnet-anime ...")
img = Image.open(SRC)
session = new_session("isnet-anime")
out = remove(img, session=session)

# 2. 清小孤立块
arr = np.array(out, dtype=np.float32)
alpha = arr[:, :, 3]
mask = alpha > 30
labeled, n = ndimage.label(mask)
if n > 0:
    component_ids, counts = np.unique(labeled[labeled > 0], return_counts=True)
    largest = counts.max()
    keep_ids = component_ids[counts >= max(largest * 0.06, 600)]
    keep_mask = np.isin(labeled, keep_ids)
    arr[:, :, 3] = np.where(keep_mask, alpha, 0)

# 3. 清灰边残影：alpha 阈值 + 轻微腐蚀
def clean_fringe(arr):
    a = arr[:, :, 3]
    mask = a > 50
    struct = np.ones((3, 3))
    eroded = ndimage.binary_erosion(mask, struct, iterations=1)
    arr[:, :, 3] = np.where(eroded, a, 0)
    return arr

arr = clean_fringe(arr)

# 4. 颜色清灰：把低饱和度、中等明度的像素 alpha 降低（去除内部阴影）
def remove_gray_shadow(arr):
    rgb = arr[:, :, :3] / 255.0
    a = arr[:, :, 3]
    # 转成 HSV
    maxc = rgb.max(axis=2)
    minc = rgb.min(axis=2)
    delta = maxc - minc
    sat = np.where(maxc > 0, delta / maxc, 0)
    val = maxc
    # 目标：半透明边缘里的灰阴影，且不是纯白/纯黑线条
    gray = (sat < 0.20) & (val > 0.35) & (val < 0.95)
    # 只对边界附近（alpha 中低）的灰色生效，避免伤到正常阴影
    edgeish = (a > 30) & (a < 245)
    kill = gray & edgeish
    arr[:, :, 3] = np.where(kill, 0, a)
    return arr

arr = remove_gray_shadow(arr)

out = Image.fromarray(arr.astype(np.uint8), "RGBA")
OUT.parent.mkdir(parents=True, exist_ok=True)
out.save(OUT, "PNG")
print(f"saved -> {OUT}")
