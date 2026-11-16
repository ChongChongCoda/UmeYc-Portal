(() => {
  const form = document.getElementById('image-form');
  const message = document.getElementById('message');
  const forms = document.getElementById('forms');
  let uploading = false;
  document.getElementById('url-form').addEventListener('submit', (event) => {
    if (uploading) event.preventDefault();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (uploading) return;
    const file = document.getElementById('image').files[0];
    if (!file) return;
    if (file.size <= 0 || file.size > 64 * 1024 * 1024) {
      message.textContent = '请选择不超过 64 MB 的图片。';
      return;
    }
    uploading = true;
    const buttons = [...forms.querySelectorAll('button')];
    buttons.forEach((button) => { button.disabled = true; });
    message.textContent = '正在上传 0%…';
    const request = new XMLHttpRequest();
    request.open('POST', `${location.pathname}?upload=1&filename=${encodeURIComponent(file.name)}`);
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.timeout = 300000;
    request.upload.addEventListener('progress', (progress) => {
      if (progress.lengthComputable) {
        const percent = Math.round(progress.loaded / progress.total * 100);
        message.textContent = percent === 100 ? '正在保存图片…' : `正在上传 ${percent}%…`;
      }
    });
    const failed = () => {
      message.textContent = '连接中断，请保持扫码窗口打开，并在同一 Wi-Fi 下重试。';
    };
    request.addEventListener('load', () => {
      try {
        message.textContent = JSON.parse(request.responseText).message;
      } catch {
        message.textContent = '上传失败，请在 Deck 上刷新二维码后重试。';
      }
      if (request.status === 200) forms.style.display = 'none';
    });
    request.addEventListener('error', failed);
    request.addEventListener('timeout', failed);
    request.addEventListener('loadend', () => {
      uploading = false;
      buttons.forEach((button) => { button.disabled = false; });
    });
    request.send(file);
  });
})();
