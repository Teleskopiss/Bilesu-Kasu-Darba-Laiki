// scraper.js
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

// Rīga station is excluded - schedule is complex but never changes
const RIGA_STATIC_SCHEDULE = {
  type: 'segments',
  weekday: ['04:35-23:50'],
  saturday: ['04:35-23:50'],
  sunday: ['04:35-23:50']
};

const STATIONS = {
  tukums: [
    { name: 'Torņakalns', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/tornakalns/' },
    { name: 'Zasulauks', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/zasulauks/' },
    { name: 'Zolitūde', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/zolitude/' },
    { name: 'Imanta', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/imanta/' },
    { name: 'Bulduri', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/bulduri/' },
    { name: 'Majori', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/majori/' },
    { name: 'Dubulti', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/dubulti/' },
    { name: 'Sloka', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/sloka/' },
    { name: 'Tukums I', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/tukums-i/' }
  ],
  jelgavas: [
    { name: 'Torņakalns', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/tornakalns/' },
    { name: 'Olaine', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/olaine/' },
    { name: 'Jelgava', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/jelgava/' }
  ],
  skulte: [
    { name: 'Zemitāni', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/zemitani/' }
  ],
  aizkraukles: [
    { name: 'Salaspils', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/salaspils/' },
    { name: 'Ogre', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/ogre/' },
    { name: 'Lielvārde', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/lielvarde/' },
    { name: 'Aizkraukle', url: 'https://www.vivi.lv/lv/biletes/bilesu-kasu-darba-laiki/aizkraukle/' }
  ]
};

function normalizeTime(timeStr) {
  if (!timeStr) return null;
  
  timeStr = timeStr.trim();
  
  // Skip if it's closed or a dash
  if (timeStr.toLowerCase().includes('slēgts') || 
      timeStr.toLowerCase().includes('nedarbojas') ||
      timeStr === '-') {
    return null;
  }
  
  // Convert "7.00 - 8.40" or "7:00 - 8:40" to "07:00-08:40"
  const match = timeStr.match(/(\d{1,2})[.:](\d{2})\s*-\s*(\d{1,2})[.:](\d{2})/);
  if (match) {
    const startHour = match[1].padStart(2, '0');
    const startMin = match[2];
    const endHour = match[3].padStart(2, '0');
    const endMin = match[4];
    return `${startHour}:${startMin}-${endHour}:${endMin}`;
  }
  
  return null;
}

async function scrapeStation(url) {
  try {
    console.log(`  Fetching: ${url}`);
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    
    const schedule = {
      type: 'segments',
      weekday: [],
      saturday: [],
      sunday: []
    };
    
    // Strategy: Find ALL individual time rows in the HTML
    // Look for elements that contain ONLY a time pattern (not part of a sentence)
    
    let inWeekdaySection = false;
    let inWeekendSection = false;
    let inEverydaySection = false;
    
    // Scan all text elements on the page
    $('*').each((i, elem) => {
      const text = $(elem).text().trim();
      const directText = $(elem).contents().filter(function() {
        return this.nodeType === 3; // Text nodes only
      }).text().trim();
      
      // Check if this is a section header
      if (text.match(/^Darba\s+dienās$/i)) {
        inWeekdaySection = true;
        inWeekendSection = false;
        inEverydaySection = false;
        console.log(`  Found section: Darba dienās`);
        return;
      }
      if (text.match(/^Brīvdienās$/i)) {
        inWeekdaySection = false;
        inWeekendSection = true;
        inEverydaySection = false;
        console.log(`  Found section: Brīvdienās`);
        return;
      }
      if (text.match(/^Katru\s+dienu$/i)) {
        inWeekdaySection = false;
        inWeekendSection = false;
        inEverydaySection = true;
        console.log(`  Found section: Katru dienu`);
        return;
      }
      
      // Check if this element contains ONLY a time range (no other text)
      // Must be format like "7.00 - 8.40" or "7:00 - 8:40"
      const exactTimeMatch = text.match(/^\s*\d{1,2}[.:]\d{2}\s*-\s*\d{1,2}[.:]\d{2}\s*$/);
      
      if (exactTimeMatch) {
        const normalizedTime = normalizeTime(text);
        if (normalizedTime) {
          if (inEverydaySection) {
            schedule.weekday.push(normalizedTime);
            schedule.saturday.push(normalizedTime);
            schedule.sunday.push(normalizedTime);
            console.log(`    Every day: ${normalizedTime}`);
          } else if (inWeekdaySection) {
            schedule.weekday.push(normalizedTime);
            console.log(`    Weekday: ${normalizedTime}`);
          } else if (inWeekendSection) {
            schedule.saturday.push(normalizedTime);
            schedule.sunday.push(normalizedTime);
            console.log(`    Weekend: ${normalizedTime}`);
          }
        }
      }
    });
    
    // Remove duplicates
    schedule.weekday = [...new Set(schedule.weekday)];
    schedule.saturday = [...new Set(schedule.saturday)];
    schedule.sunday = [...new Set(schedule.sunday)];
    
    console.log(`  Final result: ${schedule.weekday.length} weekday, ${schedule.saturday.length} weekend segments`);
    
    return schedule;
  } catch (error) {
    console.error(`  Error scraping ${url}:`, error.message);
    return null;
  }
}

async function scrapeAllStations() {
  const data = {
    lastUpdated: new Date().toISOString(),
    lines: {}
  };
  
  for (const [lineId, stations] of Object.entries(STATIONS)) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Scraping ${lineId} line...`);
    console.log('='.repeat(60));
    
    data.lines[lineId] = {
      name: lineId.charAt(0).toUpperCase() + lineId.slice(1) + ' līnija',
      stations: {
        'Rīga': RIGA_STATIC_SCHEDULE
      }
    };
    
    for (const station of stations) {
      console.log(`\nStation: ${station.name}`);
      const schedule = await scrapeStation(station.url);
      
      if (schedule && (schedule.weekday.length > 0 || schedule.saturday.length > 0)) {
        data.lines[lineId].stations[station.name] = schedule;
      } else {
        console.log(`  ⚠ Warning: No schedule found`);
        data.lines[lineId].stations[station.name] = {
          type: 'segments',
          weekday: [],
          saturday: [],
          sunday: []
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
  
  return data;
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('ViVi Schedule Scraper');
  console.log('='.repeat(60));
  
  const data = await scrapeAllStations();
  
  fs.writeFileSync('schedules.json', JSON.stringify(data, null, 2));
  
  console.log('\n' + '='.repeat(60));
  console.log('✓ SUCCESS: Schedules saved to schedules.json');
  console.log(`✓ Last updated: ${data.lastUpdated}`);
  console.log('='.repeat(60) + '\n');
}

main().catch(console.error);
