"""One bounded reader for story, world, relationship and style source material."""
import hashlib
import io
import ipaddress
import re
import shutil
import socket
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from html.parser import HTMLParser
from pathlib import Path

from storage.fs_store import now_iso

MAX_BYTES = 12 * 1024 * 1024
MAX_TEXT = 300000


class _PageText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts, self.hidden = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in {'script', 'style', 'noscript', 'svg'}:
            self.hidden += 1
        elif not self.hidden and tag in {'p', 'div', 'br', 'li', 'h1', 'h2', 'h3', 'tr'}:
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in {'script', 'style', 'noscript', 'svg'} and self.hidden:
            self.hidden -= 1
        elif not self.hidden and tag in {'p', 'div', 'li', 'h1', 'h2', 'h3', 'tr'}:
            self.parts.append('\n')

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def normalize_text(text):
    return re.sub(r'\n{3,}', '\n\n', text.replace('\r\n', '\n').replace('\r', '\n').replace('\ufeff', '')).strip()


def decode_text(raw):
    encodings = ['utf-16'] if raw.startswith((b'\xff\xfe', b'\xfe\xff')) else ['utf-8-sig', 'gb18030']
    for encoding in encodings:
        try:
            text = raw.decode(encoding)
            if '\x00' not in text:
                return text
        except UnicodeDecodeError:
            pass
    raise ValueError('无法可靠读取文字编码，请另存为 UTF-8 文本后导入。')


def read_file(raw, filename):
    if not raw or len(raw) > MAX_BYTES:
        raise ValueError('请选择非空且不超过12 MB的材料。')
    name = Path(str(filename or '材料.txt').replace('\\', '/')).name[:150]
    extension = Path(name).suffix.lower()
    result = {'filename': name, 'version': hashlib.sha256(raw).hexdigest(), 'kind': 'author_reference', 'fetched_at': now_iso(), 'warnings': [], 'coverage': 'uploaded_file', 'mime_type': 'text/plain'}
    if extension in {'.txt', '.md'}:
        text = decode_text(raw)
    elif extension == '.docx':
        result['mime_type'] = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as document:
                info = document.getinfo('word/document.xml')
                if info.file_size > 8 * MAX_BYTES:
                    raise ValueError('Word文字内容过大，请拆分后导入。')
                tree = ET.fromstring(document.read(info))
                ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
                text = '\n'.join(''.join(paragraph.itertext()) for paragraph in tree.findall('.//w:p', ns))
                result['coverage'] = 'document_body_text'
                result['warnings'].append('已读取Word正文文字；批注、嵌入图片和排版未自动解释。')
        except (zipfile.BadZipFile, KeyError, ET.ParseError) as exc:
            raise ValueError('Word文件无法读取，请使用有效的.docx文件。') from exc
    elif extension in {'.pdf', '.doc'}:
        command = shutil.which('pdftotext' if extension == '.pdf' else 'libreoffice')
        if not command:
            raise ValueError('本机尚无此格式的文字提取工具，请导出为TXT或DOCX；原材料不会被修改。')
        with tempfile.TemporaryDirectory(prefix='novix-material-') as temporary:
            source = Path(temporary) / ('source' + extension)
            source.write_bytes(raw)
            if extension == '.pdf':
                if not raw.startswith(b'%PDF-'):
                    raise ValueError('文件不是有效PDF。')
                arguments = [command, '-layout', str(source), '-']
            else:
                arguments = [command, '-env:UserInstallation=' + (Path(temporary) / 'profile').as_uri(), '--headless', '--convert-to', 'txt:Text', '--outdir', temporary, str(source)]
            try:
                output = subprocess.run(arguments, capture_output=True, timeout=25, check=True)
                text = decode_text(output.stdout) if extension == '.pdf' else decode_text((Path(temporary) / 'source.txt').read_bytes())
            except (subprocess.SubprocessError, OSError) as exc:
                raise ValueError('文件文字提取未完成，请检查文件是否损坏、加密或需要密码。') from exc
        result['mime_type'] = 'application/pdf' if extension == '.pdf' else 'application/msword'
        result['coverage'] = 'document_text'
        if extension == '.pdf' and text.strip():
            result['pages_read'] = list(range(1, len(text.rstrip('\f\n').split('\f')) + 1))
        if not text.strip():
            text = ''
            result['coverage'] = 'needs_visual_reading'
            result['warnings'].append('未读取到文字；扫描PDF需要视觉识别，不能据文件名生成设定。')
    elif extension in {'.png', '.jpg', '.jpeg'}:
        from services.character_image_service import CharacterImageService
        if raw.startswith(b'\x89PNG\r\n\x1a\n'):
            CharacterImageService._png(raw)
            result['mime_type'] = 'image/png'
        elif raw.startswith(b'\xff\xd8'):
            CharacterImageService._jpeg(raw)
            result['mime_type'] = 'image/jpeg'
        else:
            raise ValueError('图片格式与文件内容不一致，请重新导出PNG或JPEG。')
        text = ''
        result['coverage'] = 'needs_visual_reading'
        result['warnings'].append('图片已保留，尚未识别；提取时需选择支持图片的模型。')
    else:
        raise ValueError('支持TXT、Markdown、PDF、Word（DOCX/DOC）、PNG和JPEG材料。')
    if len(text) > MAX_TEXT:
        raise ValueError('文字超过30万字，请分批导入；不会静默截断材料。')
    return {**result, 'original_text': text, 'text': normalize_text(text)}


def _public_url(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in {'http', 'https'} or not parsed.hostname or parsed.username or parsed.password or parsed.port not in {None, 80, 443}:
        raise ValueError('请使用不含登录信息的公开HTTP或HTTPS网页链接。')
    try:
        addresses = socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == 'https' else 80), type=socket.SOCK_STREAM)
    except OSError as exc:
        raise ValueError('网页域名无法解析，请检查链接。') from exc
    if any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
        raise ValueError('网页导入只读取公开网络地址，不能访问本机或内网服务。')
    return parsed


def read_url(url):
    class CheckedRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            _public_url(newurl)
            return super().redirect_request(req, fp, code, msg, headers, newurl)
    _public_url(url)
    opener = urllib.request.build_opener(CheckedRedirect())
    try:
        request = urllib.request.Request(url, headers={'User-Agent': 'novix.ai material reader', 'Accept': 'text/html,text/plain,application/pdf'})
        with opener.open(request, timeout=18) as response:
            raw = response.read(MAX_BYTES + 1)
            if len(raw) > MAX_BYTES:
                raise ValueError('网页材料超过12 MB，请指定范围或下载后分批导入。')
            mime = response.headers.get_content_type()
            final_url = response.url
            if mime == 'application/pdf':
                result = read_file(raw, '网页参考.pdf')
            else:
                encoding = response.headers.get_content_charset() or 'utf-8'
                try:
                    html = raw.decode(encoding)
                except (UnicodeDecodeError, LookupError):
                    html = decode_text(raw)
                parser = _PageText()
                parser.feed(html)
                text = normalize_text(''.join(parser.parts)) if 'html' in mime else normalize_text(html)
                if not text:
                    raise ValueError('网页没有可读取正文，可能需要登录或动态加载；请复制正文或上传文件。')
                if len(text) > MAX_TEXT:
                    raise ValueError('网页文字超过30万字，请指定范围后导入。')
                limited = len(text) < 200 or bool(re.search(r'登录后.{0,10}(查看|阅读)|请登录|sign in to (read|continue)', text, re.I))
                result = {'original_text': text, 'text': text, 'coverage': 'limited_page_text' if limited else 'fetched_page_text', 'warnings': ['仅成功读取当前网页文字，不代表整部作品或登录后全文。'], 'mime_type': mime, 'kind': 'author_reference'}
                if limited:
                    result['warnings'].append('内容较少或检测到登录提示，请核对实际读取范围后再采用。')
            return {**result, 'url': url, 'final_url': final_url, 'fetched_at': now_iso(), 'version': hashlib.sha256(raw).hexdigest()}
    except (urllib.error.URLError, TimeoutError) as exc:
        raise ValueError('网页读取失败，可能受登录或网络限制；请复制正文或上传文件，不会用标题代替原文。') from exc
