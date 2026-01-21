// scraper.js
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

// Rīga station is excluded - schedule is complex but never changes
const RIGA_STATIC_SCHEDULE = {
  type: 'segments',
  weekday: ['04:35-23:50'],
  weekend: ['04:35-23:50']
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
  
  if (timeStr.toLowerCase().includes('slēgts') || 
      timeStr.toLowerCase().includes('nedarbojas') ||
      timeStr === '-') {
    return null;
  }
  
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

function extractSummaryTimes(pageText) {
  const summary = {
    weekdayStart: null,
    weekdayEnd: null,
    weekendStart: null,
    weekendEnd: null
  };
  
  const weekdayMatch = pageText.match(/darba\s+dienās[^0-9]*no\s+plkst[.\s]*(\d{1,2}[.:]\d{2})[^0-9]*līdz[^0-9]*(\d{1,2}[.:]\d{2})/i);
  if (weekdayMatch) {
    summary.weekdayStart = weekdayMatch[1].replace('.', ':');
    summary.weekdayEnd = weekdayMatch[2].replace('.', ':');
    console.log(`  Summary weekday hours: ${summary.weekdayStart} - ${summary.weekdayEnd}`);
  }
  
  const weekendMatch = pageText.match(/brīvdienās[^0-9]*(?:no\s+plkst[.\s]*)?(\d{1,2}[.:]\d{2})[^0-9]*līdz[^0-9]*(\d{1,2}[.:]\d{2})/i);
  if (weekendMatch) {
    summary.weekendStart = weekendMatch[1].replace('.', ':');
    summary.weekendEnd = weekendMatch[2].replace('.', ':');
    console.log(`  Summary weekend hours: ${summary.weekendStart} - ${summary.weekendEnd}`);
  }
  
  return summary;
}

async function scrapeStation(url) {
  try {
    console.log(`  Fetching: ${url}`);
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    
    const schedule = {
      type: 'segments',
      weekday: [],
      weekend: []
    };
    
    const pageText = $('body').text();
    const summary = extractSummaryTimes(pageText);
    
    const expectsWeekdays = pageText.match(/darba\s+dien/i);
    const expectsWeekends = pageText.match(/brīvdien/i);
    const expectsEveryday = pageText.match(/katru\s+dien/i);
    const weekendsClosed = pageText.match(/brīvdienās.*slēgts/i) || pageText.match(/svētku\s+dienās.*slēgts/i);
    
    console.log(`  Page analysis:`);
    console.log(`    - Mentions weekdays: ${!!expectsWeekdays}`);
    console.log(`    - Mentions weekends: ${!!expectsWeekends}`);
    console.log(`    - Mentions every day: ${!!expectsEveryday}`);
    console.log(`    - Weekends explicitly closed: ${!!weekendsClosed}`);
    
    // Extract data from tables
    let foundTable = false;
    
    $('table').each((tableIndex, table) => {
      const rows = $(table).find('tr');
      if (rows.length === 0) return;
      
      const tableText = $(table).text();
      if (!tableText.match(/\d{1,2}[.:]\d{2}\s*-\s*\d{1,2}[.:]\d{2}/)) {
        return;
      }
      
      console.log(`  Checking table ${tableIndex + 1}...`);
      
      let hasWeekdayHeader = false;
      let hasWeekendHeader = false;
      let hasEverydayHeader = false;
      
      $(table).find('th, strong, b').each((i, elem) => {
        const headerText = $(elem).text().trim();
        if (headerText.match(/darba\s*dien/i)) hasWeekdayHeader = true;
        if (headerText.match(/brīvdien/i)) hasWeekendHeader = true;
        if (headerText.match(/katru\s*dien/i)) hasEverydayHeader = true;
      });
      
      console.log(`    Headers: weekday=${hasWeekdayHeader}, weekend=${hasWeekendHeader}, everyday=${hasEverydayHeader}`);
      
      rows.each((rowIndex, row) => {
        const cells = $(row).find('td');
        if (cells.length === 0) return;
        
        const col1 = $(cells[0]).text().trim();
        const col2 = cells.length > 1 ? $(cells[1]).text().trim() : '';
        
        const time1 = normalizeTime(col1);
        const time2 = normalizeTime(col2);
        
        if (time1) {
          foundTable = true;
          
          if (hasEverydayHeader) {
            schedule.weekday.push(time1);
            schedule.weekend.push(time1);
            console.log(`    Every day: ${time1}`);
          } else if (hasWeekdayHeader && hasWeekendHeader) {
            schedule.weekday.push(time1);
            if (time2) {
              schedule.weekend.push(time2);
              console.log(`    Weekday: ${time1}, Weekend: ${time2}`);
            } else {
              console.log(`    Weekday: ${time1}, Weekend: (empty)`);
            }
          } else if (hasWeekdayHeader && !hasWeekendHeader) {
            schedule.weekday.push(time1);
            console.log(`    Weekday only: ${time1}`);
          } else {
            schedule.weekday.push(time1);
            if (time2) {
              schedule.weekend.push(time2);
              console.log(`    Assumed format - Weekday: ${time1}, Weekend: ${time2}`);
            }
          }
        }
      });
    });
    
    // Remove duplicates
    schedule.weekday = [...new Set(schedule.weekday)];
    schedule.weekend = [...new Set(schedule.weekend)];
    
    console.log(`  Extracted: ${schedule.weekday.length} weekday, ${schedule.weekend.length} weekend segments`);
    
    // Validation
    if (expectsEveryday && (schedule.weekday.length === 0 || schedule.weekend.length === 0)) {
      console.log(`  ⚠️ ERROR: Page says "katru dienu" but missing data!`);
    }
    
    if (expectsWeekdays && schedule.weekday.length === 0 && !weekendsClosed) {
      console.log(`  ⚠️ ERROR: Page mentions weekdays but no weekday data found!`);
    }
    
    // Check if scraping completely failed
    if (schedule.weekday.length === 0 && schedule.weekend.length === 0 && !weekendsClosed && (expectsWeekdays || expectsEveryday)) {
      console.log(`  ⚠️ CRITICAL: No data extracted - scraping failed!`);
      return null;
    }
    
    // Fix weekend data if needed
    let needsFix = false;
    
    if (expectsWeekends && !weekendsClosed && schedule.weekend.length === 0 && summary.weekendStart) {
      console.log(`  ⚠️ Weekend data missing but summary shows weekend hours`);
      needsFix = true;
    }
    
    if (needsFix && summary.weekendStart && summary.weekdayStart && schedule.weekday.length > 0) {
      console.log(`  Attempting to fix weekend schedule using summary times...`);
      
      schedule.weekend = [...schedule.weekday];
      
      const weekdayFirstTime = schedule.weekday[0].split('-')[0];
      const weekendShouldStart = summary.weekendStart.padStart(5, '0').replace('.', ':');
      
      if (weekdayFirstTime !== weekendShouldStart) {
        const firstSegmentEnd = schedule.weekend[0].split('-')[1];
        schedule.weekend[0] = `${weekendShouldStart}-${firstSegmentEnd}`;
        console.log(`    Adjusted weekend first segment to start at ${weekendShouldStart}`);
      }
      
      const weekdayLastTime = schedule.weekday[schedule.weekday.length - 1].split('-')[1];
      const weekendShouldEnd = summary.weekendEnd.padStart(5, '0').replace('.', ':');
      
      if (weekdayLastTime !== weekendShouldEnd) {
        const lastSegmentStart = schedule.weekend[schedule.weekend.length - 1].split('-')[0];
        schedule.weekend[schedule.weekend.length - 1] = `${lastSegmentStart}-${weekendShouldEnd}`;
        console.log(`    Adjusted weekend last segment to end at ${weekendShouldEnd}`);
      }
    }
    
    if (weekendsClosed) {
      schedule.weekend = [];
      console.log(`  ✓ Weekends set to closed (explicitly stated)`);
    }
    
    console.log(`  Final: ${schedule.weekday.length} weekday, ${schedule.weekend.length} weekend segments`);
    
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
  
  let errorCount = 0;
  
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
      
      if (schedule && (schedule.weekday.length > 0 || schedule.weekend.length > 0)) {
        data.lines[lineId].stations[station.name] = schedule;
      } else if (schedule === null) {
        // Scraping failed completely - mark as data unavailable
        console.log(`  ⚠️ CRITICAL: Scraping failed for ${station.name}`);
        errorCount++;
        data.lines[lineId].stations[station.name] = {
          type: 'segments',
          weekday: null,
          weekend: null,
          dataUnavailable: true
        };
      } else {
        // Both are empty arrays - station doesn't work (like closed permanently)
        console.log(`  ⚠️ WARNING: No schedule found for ${station.name}`);
        errorCount++;
        data.lines[lineId].stations[station.name] = {
          type: 'segments',
          weekday: [],
          weekend: []
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
  
  return { data, errorCount };
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('ViVi Schedule Scraper');
  console.log('='.repeat(60));
  
  const { data, errorCount } = await scrapeAllStations();
  
  fs.writeFileSync('schedules.json', JSON.stringify(data, null, 2));
  
  console.log('\n' + '='.repeat(60));
  console.log('✓ SUCCESS: Schedules saved to schedules.json');
  console.log(`✓ Last updated: ${data.lastUpdated}`);
  if (errorCount > 0) {
    console.log(`⚠️  ${errorCount} station(s) had issues - check logs above`);
  }
  console.log('='.repeat(60) + '\n');
}

main().catch(console.error);