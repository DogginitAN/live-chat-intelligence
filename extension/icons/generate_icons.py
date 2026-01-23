#!/usr/bin/env python3
"""
Generate placeholder icons for the Chrome extension
Run: python3 generate_icons.py
"""

import base64
import struct
import zlib

def create_png(size, color=(59, 130, 246)):
    """Create a simple solid-color PNG"""
    
    def png_chunk(chunk_type, data):
        chunk_len = len(data)
        chunk = struct.pack('>I', chunk_len) + chunk_type + data
        crc = zlib.crc32(chunk_type + data) & 0xffffffff
        return chunk + struct.pack('>I', crc)
    
    # PNG signature
    signature = b'\x89PNG\r\n\x1a\n'
    
    # IHDR chunk
    width = height = size
    bit_depth = 8
    color_type = 2  # RGB
    ihdr_data = struct.pack('>IIBBBBB', width, height, bit_depth, color_type, 0, 0, 0)
    ihdr = png_chunk(b'IHDR', ihdr_data)
    
    # IDAT chunk (image data)
    raw_data = b''
    r, g, b = color
    for y in range(height):
        raw_data += b'\x00'  # Filter type: none
        for x in range(width):
            # Create a simple gradient circle
            cx, cy = size // 2, size // 2
            dx, dy = x - cx, y - cy
            dist = (dx*dx + dy*dy) ** 0.5
            radius = size * 0.4
            
            if dist < radius:
                # Inside circle - blue
                raw_data += bytes([r, g, b])
            elif dist < radius + 2:
                # Border
                raw_data += bytes([30, 30, 40])
            else:
                # Background - dark
                raw_data += bytes([15, 15, 25])
    
    compressed = zlib.compress(raw_data, 9)
    idat = png_chunk(b'IDAT', compressed)
    
    # IEND chunk
    iend = png_chunk(b'IEND', b'')
    
    return signature + ihdr + idat + iend

def main():
    sizes = [16, 32, 48, 128]
    
    for size in sizes:
        png_data = create_png(size)
        filename = f'icon{size}.png'
        
        with open(filename, 'wb') as f:
            f.write(png_data)
        
        print(f'Created {filename} ({len(png_data)} bytes)')

if __name__ == '__main__':
    main()
