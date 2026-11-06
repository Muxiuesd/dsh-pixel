from PIL import Image
import sys
a = Image.open(r"D:\code\dsh-pixel\out\doc-now.png").convert("RGBA")
b = Image.open(r"D:\code\dsh-pixel\dsh-pixel-icon.png").convert("RGBA")
print("doc size", a.size, "icon size", b.size)
if a.size != b.size:
    sys.exit(0)
diff = 0
for y in range(a.size[1]):
    for x in range(a.size[0]):
        pa, pb = a.getpixel((x, y)), b.getpixel((x, y))
        if pa != pb:
            diff += 1
            if diff <= 8:
                print("diff at", (x, y), "doc", pa, "icon", pb)
print("differing pixels:", diff, "of", a.size[0]*a.size[1])
