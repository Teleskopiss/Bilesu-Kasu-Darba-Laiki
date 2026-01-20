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
    
    // First, read the summary text at the top to understand expectations
    const pageText = $('body').text();
    
    const expectsWeekdays = pageText.match(/darba\s+dien/i);
    const expectsWeekends = pageText.match(/brīvdien/i);
    const expectsEveryday = pageText.match(/katru\s+dien/i);
    const weekendsClosed = pageText.match(/brīvdienās.*slēgts/i) || pageText.match(/svētku\s+dienās.*slēgts/i);
    
    console.log(`  Page analysis:`);
    console.log(`    - Mentions weekdays: ${!!expectsWeekdays}`);
    console.log(`    - Mentions weekends: ${!!expectsWeekends}`);
    console.log(`    - Mentions every day: ${!!expectsEveryday}`);
    console.log(`    - Weekends explicitly closed: ${!!weekendsClosed}`);
    
    // METHOD 1: Try to find table with clear structure
    let foundData = false;
    
    $('table').each((tableIndex, table) => {
      const tableText = $(table).text();
      
      // Check if this table has the time data we need
      if (tableText.match(/\d{1,2}[.:]\d{2}\s*-\s*\d{1,2}[.:]\d{2}/)) {
        console.log(`  Found table with time data`);
        
        let currentSection = null;
        
        $(table).find('tr, th, td, p, div').each((i, elem) => {
          const elemText = $(elem).clone().children().remove().end().text().trim();
          
          // Detect section headers
          if (elemText.match(/^Darba\s+dienās$/i)) {
            currentSection = 'weekday';
            console.log(`    Section: Weekdays`);
          } else if (elemText.match(/^Brīvdienās$/i)) {
            currentSection = 'weekend';
            console.log(`    Section: Weekends`);
          } else if (elemText.match(/^Katru\s+dienu$/i)) {
            currentSection = 'everyday';
            console.log(`    Section: Every day`);
          } 
          // Check if this is a pure time entry
          else if (elemText.match(/^\d{1,2}[.:]\d{2}\s*-\s*\d{1,2}[.:]\d{2}$/)) {
            const time = normalizeTime(elemText);
            if (time && currentSection) {
              if (currentSection === 'everyday') {
                schedule.weekday.push(time);
                schedule.saturday.push(time);
                schedule.sunday.push(time);
              } else if (currentSection === 'weekday') {
                schedule.weekday.push(time);
              } else if (currentSection === 'weekend') {
                schedule.saturday.push(time);
                schedule.sunday.push(time);
              }
              foundData = true;
            }
          }
        });
      }
    });
    
    // METHOD 2: If table method didn't work, try extracting from full page
    if (!foundData) {
      console.log(`  Table extraction failed, trying full page scan...`);
      
      let currentSection = null;
      
      $('*').each((i, elem) => {
        const elemText = $(elem).clone().children().remove().end().text().trim();
        
        if (elemText.match(/^Darba\s+dienās$/i)) {
          currentSection = 'weekday';
        } else if (elemText.match(/^Brīvdienās$/i)) {
          currentSection = 'weekend';
        } else if (elemText.match(/^Katru\s+dienu$/i)) {
          currentSection = 'everyday';
        } else if (elemText.match(/^\d{1,2}[.:]\d{2}\s*-\s*\d{1,2}[.:]\d{2}$/)) {
          const time = normalizeTime(elemText);
          if (time && currentSection) {
            if (currentSection === 'everyday') {
              schedule.weekday.push(time);
              schedule.saturday.push(time);
              schedule.sunday.push(time);
            } else if (currentSection === 'weekday') {
              schedule.weekday.push(time);
            } else if (currentSection === 'weekend') {
              schedule.saturday.push(time);
              schedule.sunday.push(time);
            }
            foundData = true;
          }
        }
      });
    }
    
    // Remove duplicates
    schedule.weekday = [...new Set(schedule.weekday)];
    schedule.saturday = [...new Set(schedule.saturday)];
    schedule.sunday = [...new Set(schedule.sunday)];
    
    // VALIDATION: Check if we got the expected data
    console.log(`  Extracted: ${schedule.weekday.length} weekday, ${schedule.saturday.length} weekend segments`);
    
    let hasError = false;
    
    if (expectsEveryday && (schedule.weekday.length === 0 || schedule.saturday.length === 0)) {
      console.log(`  ⚠️ ERROR: Page says "katru dienu" but missing data!`);
      console.log(`     Weekdays: ${schedule.weekday.length}, Weekends: ${schedule.saturday.length}`);
      hasError = true;
    }
    
    if (expectsWeekdays && schedule.weekday.length === 0) {
      console.log(`  ⚠️ ERROR: Page mentions weekdays but no weekday data found!`);
      hasError = true;
    }
    
    if (expectsWeekends && !weekendsClosed && schedule.saturday.length === 0) {
      console.log(`  ⚠️ ERROR: Page mentions weekends (not closed) but no weekend data found!`);
      hasError = true;
    }
    
    if (weekendsClosed && schedule.saturday.length === 0) {
      console.log(`  ✓ Weekends correctly empty (explicitly closed)`);
    }
    
    // If there's an error, try alternative extraction
    if (hasError) {
      console.log(`  Attempting alternative extraction method...`);
      
      // Look for ALL time patterns on the page, group them
      const allTimes = [];
      const bodyHTML = $('body').html();
      
      // Find all time patterns in the HTML
      const timeRegex = /(\d{1,2}[.:]\d{2}\s*-\s*\d{1,2}[.:]\d{2})/g;
      let match;
      while ((match = timeRegex.exec(pageText)) !== null) {
        const normalized = normalizeTime(match[1]);
        if (normalized) {
          allTimes.push(normalized);
        }
      }
      
      // Remove duplicates
      const uniqueTimes = [...new Set(allTimes)];
      console.log(`  Found ${uniqueTimes.length} unique time segments in total`);
      
      // Apply based on page context
      if (expectsEveryday && uniqueTimes.length > 0) {
        console.log(`  Applying all times to every day (katru dienu)`);
        schedule.weekday = uniqueTimes;
        schedule.saturday = uniqueTimes;
        schedule.sunday = uniqueTimes;
      } else if (expectsWeekdays && schedule.weekday.length === 0 && uniqueTimes.length > 0) {
        console.log(`  Applying all times to weekdays only`);
        schedule.weekday = uniqueTimes;
        if (weekendsClosed) {
          schedule.saturday = [];
          schedule.sunday = [];
        }
      }
    }
    
    console.log(`  Final: ${schedule.weekday.length} weekday, ${schedule.saturday.length} weekend segments`);
    
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
      
      if (schedule && (schedule.weekday.length > 0 || schedule.saturday.length > 0)) {
        data.lines[lineId].stations[station.name] = schedule;
      } else {
        console.log(`  ⚠️ WARNING: No schedule found for ${station.name}`);
        errorCount++;
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
