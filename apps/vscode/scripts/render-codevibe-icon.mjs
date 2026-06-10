#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import zlib from "node:zlib"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.join(__dirname, "..")
const outputPath = path.join(projectRoot, "assets", "icons", "icon.png")
const checkOnly = process.argv.includes("--check")

const size = 128
const scale = 4
const width = size * scale
const height = size * scale
const pixels = new Uint8ClampedArray(width * height * 4)

const bgStart = hex("#111827")
const bgMid = hex("#172033")
const bgEnd = hex("#071114")
const cStart = hex("#C7D2FE")
const cEnd = hex("#7C8DFF")
const vStart = hex("#E6FFF8")
const vMid = hex("#5EF5D7")
const vEnd = hex("#16BBA5")

function main() {
	paintRoundedRect()
	paintHighlight()
	paintStrokeShadow()
	paintCodeVibeMark()
	paintDots()

	const downsampled = downsample()
	const renderedIcon = encodePng(size, size, downsampled)
	if (checkOnly) {
		if (!fs.existsSync(outputPath)) {
			throw new Error(`Missing CodeVibe icon: ${path.relative(process.cwd(), outputPath)}`)
		}
		const currentIcon = fs.readFileSync(outputPath)
		if (!currentIcon.equals(renderedIcon)) {
			throw new Error(
				`Stale CodeVibe icon PNG: run node ${path.relative(process.cwd(), __filename)} to regenerate ${path.relative(
					process.cwd(),
					outputPath,
				)}`,
			)
		}
		console.log(`CodeVibe icon is current: ${path.relative(process.cwd(), outputPath)}`)
		return
	}
	fs.writeFileSync(outputPath, renderedIcon)
	console.log(`Rendered CodeVibe icon: ${path.relative(process.cwd(), outputPath)}`)
}

function hex(value) {
	const normalized = value.replace(/^#/, "")
	return [
		Number.parseInt(normalized.slice(0, 2), 16),
		Number.parseInt(normalized.slice(2, 4), 16),
		Number.parseInt(normalized.slice(4, 6), 16),
	]
}

function clamp(value, min = 0, max = 1) {
	return Math.min(max, Math.max(min, value))
}

function mix(a, b, t) {
	return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)]
}

function blendPixel(x, y, rgb, alpha = 1) {
	const ix = Math.trunc(x)
	const iy = Math.trunc(y)
	if (ix < 0 || iy < 0 || ix >= width || iy >= height || alpha <= 0) {
		return
	}
	const index = (iy * width + ix) * 4
	const sourceAlpha = clamp(alpha)
	const destinationAlpha = pixels[index + 3] / 255
	const outAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha)
	if (outAlpha <= 0) {
		return
	}
	pixels[index] = Math.round((rgb[0] * sourceAlpha + pixels[index] * destinationAlpha * (1 - sourceAlpha)) / outAlpha)
	pixels[index + 1] = Math.round((rgb[1] * sourceAlpha + pixels[index + 1] * destinationAlpha * (1 - sourceAlpha)) / outAlpha)
	pixels[index + 2] = Math.round((rgb[2] * sourceAlpha + pixels[index + 2] * destinationAlpha * (1 - sourceAlpha)) / outAlpha)
	pixels[index + 3] = Math.round(outAlpha * 255)
}

function distanceToRoundedRect(x, y, rx, ry, rw, rh, rr) {
	const px = x - (rx + rw / 2)
	const py = y - (ry + rh / 2)
	const qx = Math.abs(px) - (rw / 2 - rr)
	const qy = Math.abs(py) - (rh / 2 - rr)
	return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr
}

function paintRoundedRect() {
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const ux = (x + 0.5) / scale
			const uy = (y + 0.5) / scale
			const distance = distanceToRoundedRect(ux, uy, 7, 7, 114, 114, 27)
			const alpha = clamp((-distance + 0.5) / 1.25)
			if (alpha === 0) {
				continue
			}
			const diagonal = clamp((ux + uy - 24) / 208)
			const color = diagonal < 0.55 ? mix(bgStart, bgMid, diagonal / 0.55) : mix(bgMid, bgEnd, (diagonal - 0.55) / 0.45)
			blendPixel(x, y, color, alpha)
		}
	}
}

function paintHighlight() {
	const polygon = [
		[24, 25],
		[104, 25],
		[82, 51],
		[58, 68],
		[38, 86],
		[21, 103],
		[21, 28],
	]
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const ux = (x + 0.5) / scale
			const uy = (y + 0.5) / scale
			if (pointInPolygon(ux, uy, polygon)) {
				blendPixel(x, y, [255, 255, 255], 0.05)
			}
		}
	}
}

function pointInPolygon(x, y, polygon) {
	let inside = false
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const xi = polygon[i][0]
		const yi = polygon[i][1]
		const xj = polygon[j][0]
		const yj = polygon[j][1]
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
			inside = !inside
		}
	}
	return inside
}

function cPathSamples() {
	return [
		...sampleCubic([78, 31], [67, 21], [47, 21], [34, 33], 48),
		...sampleCubic([34, 33], [17, 49], [17, 79], [34, 95], 72),
		...sampleCubic([34, 95], [47, 107], [69, 107], [81, 96], 48),
	]
}

function sampleCubic(p0, p1, p2, p3, steps) {
	const points = []
	for (let index = 0; index <= steps; index++) {
		const t = index / steps
		const mt = 1 - t
		points.push([
			mt ** 3 * p0[0] + 3 * mt ** 2 * t * p1[0] + 3 * mt * t ** 2 * p2[0] + t ** 3 * p3[0],
			mt ** 3 * p0[1] + 3 * mt ** 2 * t * p1[1] + 3 * mt * t ** 2 * p2[1] + t ** 3 * p3[1],
		])
	}
	return points
}

function paintStrokeShadow() {
	paintPolyline(
		cPathSamples().map(([x, y]) => [x, y + 4]),
		20,
		() => [0, 0, 0],
		0.24,
		1.8,
	)
	paintPolyline(
		[
			[51, 49],
			[67, 90],
			[100, 42],
		],
		20,
		() => [0, 0, 0],
		0.22,
		1.8,
	)
}

function paintCodeVibeMark() {
	paintPolyline(cPathSamples(), 13.5, (x, y) => {
		const t = projectLinearGradient(x, y, [18, 28], [86, 108])
		return mix(cStart, cEnd, t)
	})
	paintPolyline(
		[
			[51, 45],
			[67, 86],
			[100, 38],
		],
		13.5,
		(x, y) => {
			const t = projectLinearGradient(x, y, [51, 39], [104, 89])
			return t < 0.45 ? mix(vStart, vMid, t / 0.45) : mix(vMid, vEnd, (t - 0.45) / 0.55)
		},
	)
}

function projectLinearGradient(x, y, start, end) {
	const dx = end[0] - start[0]
	const dy = end[1] - start[1]
	return clamp(((x - start[0]) * dx + (y - start[1]) * dy) / (dx * dx + dy * dy))
}

function paintPolyline(points, strokeWidth, colorAt, baseAlpha = 1, aaWidth = 0.85) {
	const halfWidth = strokeWidth / 2
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const ux = (x + 0.5) / scale
			const uy = (y + 0.5) / scale
			let distance = Number.POSITIVE_INFINITY
			let nearest = points[0]
			for (let index = 0; index < points.length - 1; index++) {
				const candidate = distanceToSegment(ux, uy, points[index], points[index + 1])
				if (candidate.distance < distance) {
					distance = candidate.distance
					nearest = candidate.nearest
				}
			}
			const alpha = clamp((halfWidth - distance + aaWidth) / (aaWidth * 2)) * baseAlpha
			if (alpha > 0) {
				blendPixel(x, y, colorAt(nearest[0], nearest[1]), alpha)
			}
		}
	}
}

function distanceToSegment(x, y, a, b) {
	const dx = b[0] - a[0]
	const dy = b[1] - a[1]
	const denominator = dx * dx + dy * dy || 1
	const t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / denominator)
	const nearest = [a[0] + dx * t, a[1] + dy * t]
	return {
		distance: Math.hypot(x - nearest[0], y - nearest[1]),
		nearest,
	}
}

function paintDots() {
	paintCircle(101, 37, 5.6, vStart)
	paintCircle(67, 86, 5.7, vMid)
}

function paintCircle(cx, cy, radius, color) {
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const ux = (x + 0.5) / scale
			const uy = (y + 0.5) / scale
			const distance = Math.hypot(ux - cx, uy - cy)
			const alpha = clamp((radius - distance + 0.75) / 1.5)
			if (alpha > 0) {
				blendPixel(x, y, color, alpha)
			}
		}
	}
}

function downsample() {
	const output = Buffer.alloc(size * size * 4)
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			let r = 0
			let g = 0
			let b = 0
			let a = 0
			for (let sy = 0; sy < scale; sy++) {
				for (let sx = 0; sx < scale; sx++) {
					const source = ((y * scale + sy) * width + (x * scale + sx)) * 4
					r += pixels[source]
					g += pixels[source + 1]
					b += pixels[source + 2]
					a += pixels[source + 3]
				}
			}
			const target = (y * size + x) * 4
			const samples = scale * scale
			output[target] = Math.round(r / samples)
			output[target + 1] = Math.round(g / samples)
			output[target + 2] = Math.round(b / samples)
			output[target + 3] = Math.round(a / samples)
		}
	}
	return output
}

function encodePng(imageWidth, imageHeight, rgba) {
	const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(imageWidth, 0)
	ihdr.writeUInt32BE(imageHeight, 4)
	ihdr[8] = 8
	ihdr[9] = 6
	ihdr[10] = 0
	ihdr[11] = 0
	ihdr[12] = 0
	const scanlines = Buffer.alloc((imageWidth * 4 + 1) * imageHeight)
	for (let y = 0; y < imageHeight; y++) {
		const row = y * (imageWidth * 4 + 1)
		scanlines[row] = 0
		rgba.copy(scanlines, row + 1, y * imageWidth * 4, (y + 1) * imageWidth * 4)
	}
	return Buffer.concat([
		signature,
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", zlib.deflateSync(scanlines, { level: 9 })),
		pngChunk("IEND", Buffer.alloc(0)),
	])
}

function pngChunk(type, data) {
	const typeBuffer = Buffer.from(type)
	const length = Buffer.alloc(4)
	length.writeUInt32BE(data.length, 0)
	const crc = Buffer.alloc(4)
	crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
	return Buffer.concat([length, typeBuffer, data, crc])
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
	let c = index
	for (let bit = 0; bit < 8; bit++) {
		c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
	}
	return c >>> 0
})

function crc32(buffer) {
	let crc = 0xffffffff
	for (const byte of buffer) {
		crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
	}
	return (crc ^ 0xffffffff) >>> 0
}

main()
