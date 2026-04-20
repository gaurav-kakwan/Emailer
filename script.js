// Session Check
(function () {
    var token = localStorage.getItem('sessionToken');
    if (!token) {
        window.location.href = '/login.html';
        return;
    }
    fetch('/check-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token })
    }).then(function (r) { return r.json(); }).then(function (data) {
        if (!data.valid) {
            localStorage.removeItem('sessionToken');
            window.location.href = '/login.html';
        }
    }).catch(function () {
        window.location.href = '/login.html';
    });
})();

document.getElementById('sendBtn').addEventListener('click', async function () {
    var token = localStorage.getItem('sessionToken');
    if (!token) {
        alert('Please login first.');
        window.location.href = '/login.html';
        return;
    }

    var btn = this;
    var progressSection = document.getElementById('progressSection');
    var progressBar = document.getElementById('progressBar');
    var statusText = document.getElementById('statusText');

    var senderAccounts = document.getElementById('senderAccounts').value.trim();
    var subject = document.getElementById('subject').value.trim();
    var replyTo = document.getElementById('replyTo').value.trim(); // NEW FIELD
    var message = document.getElementById('message').value.trim();
    var to = document.getElementById('to').value.trim();

    if (!senderAccounts || !subject || !message || !to) {
        alert('❌ Please fill all required fields.');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Processing...';
    progressSection.style.display = 'block';
    progressBar.style.width = '50%';
    statusText.textContent = 'Connecting & Sending...';

    try {
        var res = await fetch('/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: token,
                senderAccountsString: senderAccounts,
                subject: subject,
                replyTo: replyTo, // SENDING REPLY TO
                message: message,
                to: to
            })
        });

        var data = await res.json();
        progressBar.style.width = '100%';

        if (data.success) {
            statusText.textContent = '✅ Completed!';
            statusText.style.color = '#28a745';
            
            var summary = '✅ Sent: ' + data.sent;
            if (data.fail > 0) summary += '  ❌ Fail: ' + data.fail;
            
            setTimeout(() => {
                alert(summary + '\n(Speed: ' + (data.timeTaken || 'Fast') + 's)');
            }, 500);
        } else {
            statusText.textContent = '❌ Error';
            statusText.style.color = '#dc3545';
            progressBar.style.backgroundColor = '#dc3545';
            alert('❌ ' + data.msg);
        }
    } catch (err) {
        statusText.textContent = 'Network Error';
        statusText.style.color = '#dc3545';
        progressBar.style.backgroundColor = '#dc3545';
        alert('⚠️ Network Error!');
    }

    btn.disabled = false;
    btn.textContent = 'Send All';
});

document.getElementById('logoutBtn').addEventListener('click', function () {
    fetch('/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: localStorage.getItem('sessionToken') })
    }).finally(function () {
        localStorage.removeItem('sessionToken');
        window.location.href = '/login.html';
    });
});