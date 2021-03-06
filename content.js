var conf = {
  // Scroll screen interval
  SCR_ITV: 1000,

  // Reposition download button interval
  REPOSITION_ITV: 250,

  // Hide download button after finish timeout
  HIDE_TO: 2500,

  // Get photo data interval
  GET_PHOTO_ITV_H: 1500,
  GET_PHOTO_ITV_L: 250,
  GET_PHOTO_ITV: 250,
  
  // Get photo data timeout
  GET_PHOTO_TO: 60000
};

var options = {

};

var util = (function() {
  var obj = {};

  obj.processName = function(name) {
    return name.replace(/[\/\\:\*\?<>|"]/g, '');
  };

  return obj;
})();

var view = (function() {
  var obj = {};

  var
    $body,
    $textWrapper,
    $icon,
    $hint,
    $info,
    $btn,
    $progressBar,
    $progressBarText,
    $progressBarWrapper;

  var state = '';

  var disabled = false;

  obj.init = function() {
    state = 'init';
    $body = $('body');

    $('<link />')
      .attr({
        rel: 'stylesheet',
        type: 'text/css',
        href: chrome.extension.getURL('style.css')
      })
      .appendTo('head');

    $btn = $('<div />')
      .attr('id', 'renren_album_downloader_btn');
    $info = $('<div />')
      .attr('id', 'renren_album_downloader_btn_info')
      .appendTo($btn);
    $hint = $('<div />')
      .attr('id', 'renren_album_downloader_btn_hint')
      .addClass('clearFloat')
      .appendTo($btn);
    $icon = $('<div />')
      .attr('id', 'renren_album_downloader_btn_icon')
      .addClass('default')
      .appendTo($hint);
    $textWrapper = $('<div />')
      .attr('id', 'renren_album_downloader_btn_text')
      .html(chrome.i18n.getMessage('hint'))
      .appendTo($hint);
    $btn.appendTo($body);


    $btn.click(function() {
      if (disabled) {
        return;
      }
      disabled = true;
      $btn.addClass('disabled');

      chrome.extension.sendRequest({
        e: 'clickDownload'
      });

      view.start();

      // Switch to thumb view if in comment view
      var $commentViewBtn = $('#tabview_3_3');
      if ($commentViewBtn.hasClass('select-btn')) {
        var $thumbViewBtn = $('#tabview_3_1');
        // Fire click on thumb view button
        var evt = document.createEvent("HTMLEvents");
        evt.initEvent('click', true, true);
        $thumbViewBtn[0].dispatchEvent(evt);
      }

      view.scrollToBottom(function() {
        // Start getting photos
        album.start();
      });
    });

    (function() {
      var oriRight = 24;  // window.parseInt($btn.css('right'));
      var repositionBtn = function() {
        var $sidebar = $('#friends-panel > div.popupwindow.actived');
        if ($sidebar.length) {
          // Sidebar is here, watch out
          var newRight = $sidebar.width() + oriRight;
          $btn.css('right', newRight);
        } else {
          $btn.css('right', oriRight);
        }
        window.setTimeout(repositionBtn, conf.REPOSITION_ITV);
      };
      repositionBtn();
    })();
  };

  obj.getBody = function() {
    return $body;
  };

  obj.scrollToBottom = function(callback) {
    state = 'downloading';

    // Scroll to bottom to load all the photo links
    var $window = $(window);
    var
      oriScrollTop = $window.scrollTop(),
      curScrollTop = 0;
    var scrollDown = function() {
      curScrollTop += $window.height();
      if (curScrollTop < $(document).height()) {
        $window.scrollTop(curScrollTop);
        // Continue loop
        window.setTimeout(scrollDown, conf.SCR_ITV);
        return;
      }
      // Loop finished
      // Restore original scroll position
      $window.scrollTop(oriScrollTop);
      callback && callback();
    };
    scrollDown();
  };

  obj.start = function() {
    state = 'analyzing';
    $btn.addClass('expanded');
    $info.html(chrome.i18n.getMessage('msgAnalyzing'));
    for (var i = 0; i < 8; i++) {
      $('<div />').appendTo($icon);
    }
    $icon
      .removeClass('default')
      .removeClass('finished')
      .addClass('spinning');
  };

  var createProgressBar = function() {
    $progressBarWrapper = $('<div />')
      .attr('id', 'renren_album_downloader_progress_bar_wrapper');
    $progressBar = $('<div />')
      .attr('id', 'renren_album_downloader_progress_bar')
      .appendTo($progressBarWrapper);
    $progressBarText = $('<div />')
      .attr('id', 'renren_album_downloader_progress_bar_text')
      .appendTo($progressBarWrapper);
    $progressBarWrapper
      .prependTo($btn)
      .slideDown();
  };

  obj.startDownload = function(ttl) {
    state = 'downloading';
    $info.html(chrome.i18n.getMessage('msgDownloading'));
    createProgressBar();
    this.updateDownloadProgress(0, ttl);
  };

  obj.updateDownloadProgress = function(cur, ttl) {
    $progressBarText.html(chrome.i18n.getMessage('dldProgress', [cur.toString(), ttl.toString()]));
    $progressBar.width((cur / ttl * 100) + '%');
  };

  obj.startZipping = function(callback) {
    state = 'zipping';
    $info.html(chrome.i18n.getMessage('msgZipping'));
    $progressBarWrapper.slideUp(function() {
      $progressBarWrapper.remove();
      callback && callback();
    });
  };

  obj.finish = function() {
    state = 'finished';
    $info.html(chrome.i18n.getMessage('msgFinished'));
    disabled = false;
    $btn.removeClass('disabled');
    $icon
      .removeClass('spinning')
      .addClass('finished')
      .empty();
    window.setTimeout(function() {
      $btn.removeClass('expanded');
    }, conf.HIDE_TO);
  };

  return obj;
})();

var downloader = (function() {
  var obj = {};

  var
    zip = null,
    folder = null,
    zipName = '',
    folderName = '',
    cnt = 0,
    len = 0,
    errList = [];

  var dataURI2Blob = function(dataURI) {
    // by @Stoive from StackOverflow

    // convert base64 to raw binary data held in a string
    // doesn't handle URLEncoded DataURIs
    var byteString = atob(dataURI.split(',')[1]);

    // separate out the mime component
    var mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];

    // write the bytes of the string to an ArrayBuffer
    var ab = new ArrayBuffer(byteString.length);
    var ia = new Uint8Array(ab);
    for (var i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }

    // write the ArrayBuffer to a blob, and you're done
    return new Blob([new Uint8Array(ia)], {
      type: mimeString
    });
  };

  var triggerDownload = function(uri, filename) {
    saveAs(dataURI2Blob(uri), filename);
  };

  var createZip = function(info) {
    zip = new JSZip;
    // Create folder to put picture into
    folder = zip.folder(folderName);
    if (info) {

      $.ajax({
        async: false,
        url: chrome.extension.getURL('info.tmpl.html'),
        success: function(template) {
          var $infoHTML = $.tmpl(template, info);
          folder.file('info.html', $('<div />').append($infoHTML).remove().html());
        }
      });

    }
  };

  var startZipping = function() {
    /*var errLen = errList.length;
    if (errLen > 0) {
      var errorsTxt = '';
      errorsTxt += chrome.i18n.getMessage('errorTxtDesc');
      errorsTxt += '\r\n\r\n';
      for (var i = 0; i < errLen; i++) {
        errorsTxt += errList[i] + '\r\n';
      }
      folder.file('errors.txt', errorsTxt);
    }
    view.startZipping(function() {
      var uri = 'data:application/zip;base64,' + zip.generate();
      triggerDownload(uri, zipName);
      chrome.extension.sendRequest({
        e: 'finishDownload'
      });
      view.finish();
    });*/
    view.finish();
  };

  obj.onError = function(url) {
    len--;
    // errList.push(url);
    view.updateDownloadProgress(cnt, len);
    if (len === cnt) {
      startZipping();
    }
  };
  
  obj.add = function(data, photo) {
    cnt++;

    var base64Data = base64ArrayBuffer(data);
    //folder.file(photo.filename, base64Data, {base64: true});
    var uri = 'data:application/zip;base64,' + base64Data;
    saveAs(dataURI2Blob(uri), photo.filename);

    view.updateDownloadProgress(cnt, len);
    if (cnt === len) {
      startZipping();
    }
  };

  obj.init = function(info, folderName_, len_, zipName_) {
    folderName = folderName_;
    len = len_;
    zipName = zipName_;
    cnt = 0;
    zip = null,
    folder = null,
    errList = [];

    // Create zip and folder
    createZip(info);
  };

  return obj;
})();

var album = (function() {
  var obj = {};

  // Array of photo sources
  var
    albumName = '',
    albumDesc = '',  // Album description
    folderName = '',
    photos = [];

  var createInfo = function () {
    var ret = {
      extName: chrome.i18n.getMessage('extName'),
      title: albumName,
      desc: albumDesc,
      url: window.location.href,
      urlText: chrome.i18n.getMessage('infoAlbumLinkText'),
      photos: []
    }
    var len = photos.length;
    for (var idx = 1; idx <= len; idx++) {
      for (var i = 0; i < len; i++) {
        // Double loop to make sure photos are pushed in order
        if (photos[i].idx === idx) {
          ret.photos.push({
            idx: idx,
            title: photos[i].title,
            filename: photos[i].filename,
            pageUrl: photos[i].pageUrl
          });
          break;
        }
      }
    }
    return ret;
  };

  var downloadPhotos = function() {
    var len = photos.length;  // Number of photos
    view.startDownload(len);

    chrome.extension.sendRequest({
      e: 'startDownload', 
      opt: {
        num: len
      }
    });

    downloader.init(createInfo(), folderName, len, albumName + '.zip');

    // Get the image data of each photo and send to downloader
    var cnt = 0;  // Counts downloaded photos
    var addToQueue = function(idx) {
      if (idx >= len) {
        return;
      }
      (function() {
        var photo = photos[idx];
        if (options.originalSize === 'true') {
          var urlArr = [photo.src.original, photo.src.xlarge, photo.src.large];
        } else {
          var urlArr = [photo.src.large];
        }

        chrome.extension.sendRequest({
          "e":"downloadUrl", "url":urlArr
        }, function(){
          cnt++;
          view.updateDownloadProgress(cnt, len);
          if (cnt === len) {
            startZipping();
          }
        });
      })();
      window.setTimeout(function() {
        addToQueue(idx + 1);
      }, conf.GET_PHOTO_ITV);
    };
    addToQueue(0);
  };

  obj.start = function() {
    // Parse album id, name and description

    if (window.location.pathname.indexOf('getalbumprofile.do') !== -1){
      // profile album
      var userId = window.location.search.match(/owner=\d+/)[0].match(/\d+/)[0];
      folderName = 'renren-album-profile-' + userId;
    } else {
      var albumId = window.location.pathname.match(/album-\d+/)[0].match(/\d+/)[0];
      folderName = 'renren-album-' + albumId;
    }
    var $albumInfo = $('div.ablum-infor');
    albumName = $('span#album-name').contents()[0].data;
    albumDesc = '';//$.trim($('#describeAlbum').contents()[0].data);
    (albumDesc === '还没有相册描述...') && (albumDesc = '');

    // Get all the sources and put in photos array
    photos = [];
    var cnt = 0;
    var $photoItems = $('div#photo-list div');
    if ($photoItems.length === 0) {
      // No photos to download
      // TODO
      return;
    }

    $photoItems.each(function(idx, ele) {
      var $ele = $(ele);
      var $a = $ele.children('a');
      var pageUrl = $a.attr('href');

      var $img = $a.children('img');
      var src = (function() {
        eval('var obj = ' + $img.attr('data-viewer'));
        var large = obj.url;

        // replace '/large' with '/original' or '/xlarge' to get larger img
        var original = large.replace('/large', '/original');
        var xlarge = large.replace('/large', '/xlarge');
        return {
          large: large,
          xlarge: xlarge,
          original: original
        };
      })();
      var ext = src.large.match(/.\w{3,4}$/)[0];

      var $desc = $ele.find('span.descript');
      var title = $desc.length ? $desc.text() : '';

      photos.push({
        src: src,
        title: title,
        filename: (idx + 1) + ext,
        idx: idx + 1,
        pageUrl: pageUrl
      });
    });

    downloadPhotos();
  };

  return obj;
})();


chrome.extension.sendRequest({
  e: 'visitAlbum'
});

// get options from local storage
chrome.extension.sendRequest({
  e: 'getOption',
  name: 'originalSize'
}, function(response) {
  options.originalSize = response.value;
});

view.init();